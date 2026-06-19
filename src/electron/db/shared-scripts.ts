import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import {
  SHARED_SCRIPT_KINDS,
  SHARED_SCRIPT_SCOPE_TYPES,
  SHARED_SCRIPT_TARGETS,
  type CreateSharedScriptInput,
  type DeleteSharedScriptInput,
  type DeleteSharedScriptResponse,
  type ListSharedScriptsInput,
  type MoveSharedScriptInput,
  type SharedScriptKind,
  type SharedScriptRecord,
  type SharedScriptScopeType,
  type SharedScriptTarget,
  type UpdateSharedScriptInput,
} from '../../common/SharedScripts.js'
import { getDb } from './index.js'
import { getFolderAncestorChain } from './folders.js'
import { insertOperation } from './operations.js'
import { sharedScripts } from './schema.js'

type SharedScriptRow = typeof sharedScripts.$inferSelect

export async function listSharedScripts(input: ListSharedScriptsInput): Promise<SharedScriptRecord[]> {
  const db = getDb()
  validateScopeOrThrow(input.scopeType, input.scopeId)

  return db
    .select()
    .from(sharedScripts)
    .where(and(eq(sharedScripts.scopeType, input.scopeType), buildScopeIdPredicate(input.scopeId), isNull(sharedScripts.deletedAt)))
    .orderBy(sharedScripts.position, desc(sharedScripts.createdAt))
    .all()
    .map(toSharedScriptRecord)
}

export async function getSharedScript(id: string): Promise<SharedScriptRecord | null> {
  const db = getDb()
  const row = db.select().from(sharedScripts).where(and(eq(sharedScripts.id, id), isNull(sharedScripts.deletedAt))).get()
  return row ? toSharedScriptRecord(row) : null
}

export async function createSharedScript(input: CreateSharedScriptInput): Promise<GenericResult<SharedScriptRecord>> {
  const db = getDb()
  const validationError = validateSharedScriptInput(input)
  if (validationError) {
    return GenericError.Message(validationError)
  }

  try {
    const now = Date.now()
    const script: SharedScriptRow = {
      id: crypto.randomUUID(),
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name.trim(),
      kind: input.kind,
      targetsJson: JSON.stringify(normalizeTargets(input.targets)),
      isActive: input.isActive,
      code: input.code ?? '',
      position: getNextSharedScriptPosition(db, input.scopeType, input.scopeId),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    const duplicate = script.name
      ? getActiveSharedScriptByName(db, script.scopeType as SharedScriptScopeType, script.scopeId, script.name)
      : null
    if (duplicate) {
      return GenericError.Message(`Shared script name ${script.name} is already used in this scope`)
    }

    db.insert(sharedScripts).values(script).run()
    return Result.Success(toSharedScriptRecord(script))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateSharedScript(input: UpdateSharedScriptInput): Promise<GenericResult<SharedScriptRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!SHARED_SCRIPT_KINDS.includes(input.kind)) {
    return GenericError.Message('Invalid shared script kind')
  }

  const targets = normalizeTargets(input.targets)
  if (targets.length === 0) {
    return GenericError.Message('Select at least one shared script target')
  }

  try {
    const existing = db
      .select()
      .from(sharedScripts)
      .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
      .get()

    if (!existing) {
      return GenericError.Message('Shared script not found')
    }

    if (input.kind === 'module' && !name) {
      return GenericError.Message('Module shared scripts require a name')
    }

    const duplicate = name
      ? getActiveSharedScriptByName(db, existing.scopeType as SharedScriptScopeType, existing.scopeId, name, existing.id)
      : null
    if (duplicate) {
      return GenericError.Message(`Shared script name ${name} is already used in this scope`)
    }

    db.update(sharedScripts)
      .set({
        name,
        kind: input.kind,
        targetsJson: JSON.stringify(targets),
        isActive: input.isActive,
        code: input.code,
        updatedAt: Date.now(),
      })
      .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
      .run()

    const updated = db
      .select()
      .from(sharedScripts)
      .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
      .get()

    if (!updated) {
      return GenericError.Message('Shared script not found')
    }

    return Result.Success(toSharedScriptRecord(updated))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteSharedScript(
  input: DeleteSharedScriptInput
): Promise<GenericResult<DeleteSharedScriptResponse>> {
  const db = getDb()

  try {
    const deleted = db.transaction(tx => {
      const script = tx
        .select({ id: sharedScripts.id, name: sharedScripts.name })
        .from(sharedScripts)
        .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
        .get()

      if (!script) {
        throw new Error('Shared script not found')
      }

      const now = Date.now()
      const operation = insertOperation(tx, {
        operationType: 'delete-shared-script',
        title: script.name ? `Deleted shared script ${script.name}` : 'Deleted shared script',
        summary: 'Shared script deleted.',
        createdAt: now,
        metadata: {
          sharedScriptId: script.id,
          sharedScriptName: script.name,
          deletedAt: now,
        },
      })

      const result = tx
        .update(sharedScripts)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
        .run()

      if (result.changes === 0) {
        throw new Error('Shared script not found')
      }

      return { operation }
    })

    return Result.Success(deleted)
  } catch (error) {
    if (error instanceof Error && error.message === 'Shared script not found') {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

export async function moveSharedScript(input: MoveSharedScriptInput): Promise<GenericResult<void>> {
  const db = getDb()
  if (input.targetPosition < 0) {
    return GenericError.Message('Invalid target position')
  }

  try {
    db.transaction(tx => {
      const current = tx
        .select()
        .from(sharedScripts)
        .where(and(eq(sharedScripts.id, input.id), isNull(sharedScripts.deletedAt)))
        .get()

      if (!current) {
        throw new Error('Shared script not found')
      }

      const rows = tx
    .select({ id: sharedScripts.id })
        .from(sharedScripts)
        .where(
          and(
            eq(sharedScripts.scopeType, current.scopeType),
            buildScopeIdPredicate(current.scopeId),
            isNull(sharedScripts.deletedAt)
          )
        )
        .orderBy(sharedScripts.position, desc(sharedScripts.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('Shared script not found')
      }

      const [moved] = rows.splice(currentIndex, 1)
      rows.splice(Math.max(0, Math.min(input.targetPosition, rows.length)), 0, moved)

      rows.forEach((row, index) => {
        tx.update(sharedScripts).set({ position: index, updatedAt: Date.now() }).where(eq(sharedScripts.id, row.id)).run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error && error.message === 'Shared script not found') {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

export async function listVisibleSharedScripts(input: {
  folderId: string | null
  target?: SharedScriptTarget
  onlyActive?: boolean
  kind?: SharedScriptKind
}): Promise<SharedScriptRecord[]> {
  const db = getDb()
  const ancestors = await getFolderAncestorChain(input.folderId)
  const folderIds = ancestors.map(folder => folder.id)
  const rows = db
    .select()
    .from(sharedScripts)
    .where(
      and(
        isNull(sharedScripts.deletedAt),
        folderIds.length === 0
          ? eq(sharedScripts.scopeType, 'workspace')
          : inArray(sharedScripts.scopeType, ['workspace', 'folder'])
      )
    )
    .orderBy(asc(sharedScripts.scopeType), sharedScripts.position, desc(sharedScripts.createdAt))
    .all()
    .map(toSharedScriptRecord)
    .filter(script => (input.target ? script.targets.includes(input.target) : true))
    .filter(script => (input.onlyActive ?? true ? script.isActive : true))
    .filter(script => (input.kind ? script.kind === input.kind : true))
    .filter(script => script.scopeType === 'workspace' || folderIds.includes(script.scopeId ?? ''))

  const workspaceScripts = rows.filter(script => script.scopeType === 'workspace')
  const folderScriptsByDepth = folderIds.flatMap(folderId => rows.filter(script => script.scopeType === 'folder' && script.scopeId === folderId))

  return [...workspaceScripts, ...folderScriptsByDepth]
}

function validateSharedScriptInput(input: CreateSharedScriptInput) {
  validateScopeOrThrow(input.scopeType, input.scopeId)

  if (!SHARED_SCRIPT_KINDS.includes(input.kind)) {
    return 'Invalid shared script kind'
  }

  if (input.kind === 'module' && !input.name.trim()) {
    return 'Module shared scripts require a name'
  }

  if (normalizeTargets(input.targets).length === 0) {
    return 'Select at least one shared script target'
  }

  return null
}

function validateScopeOrThrow(scopeType: SharedScriptScopeType, scopeId: string | null) {
  if (!SHARED_SCRIPT_SCOPE_TYPES.includes(scopeType)) {
    throw new Error('Invalid shared script scope type')
  }

  if (scopeType === 'workspace' && scopeId !== null) {
    throw new Error('Workspace shared scripts cannot have a scope id')
  }

  if (scopeType === 'folder' && !scopeId) {
    throw new Error('Folder shared scripts require a folder id')
  }
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets.filter(target => SHARED_SCRIPT_TARGETS.includes(target))))
}

function getNextSharedScriptPosition(db: ReturnType<typeof getDb>, scopeType: SharedScriptScopeType, scopeId: string | null) {
  const rows = db
    .select({ position: sharedScripts.position })
    .from(sharedScripts)
    .where(and(eq(sharedScripts.scopeType, scopeType), buildScopeIdPredicate(scopeId), isNull(sharedScripts.deletedAt)))
    .all()

  if (rows.length === 0) {
    return 0
  }

  return Math.max(...rows.map(row => row.position)) + 1
}

function getActiveSharedScriptByName(
  db: ReturnType<typeof getDb>,
  scopeType: SharedScriptScopeType,
  scopeId: string | null,
  name: string,
  excludeId?: string
) {
  const rows = db
    .select()
    .from(sharedScripts)
    .where(and(eq(sharedScripts.scopeType, scopeType), buildScopeIdPredicate(scopeId), isNull(sharedScripts.deletedAt)))
    .all()

  return rows.find(row => row.name === name && row.id !== excludeId) ?? null
}

function buildScopeIdPredicate(scopeId: string | null) {
  return scopeId === null ? isNull(sharedScripts.scopeId) : eq(sharedScripts.scopeId, scopeId)
}

function toSharedScriptRecord(script: SharedScriptRow): SharedScriptRecord {
  return {
    id: script.id,
    scopeType: script.scopeType as SharedScriptScopeType,
    scopeId: script.scopeId,
    name: script.name,
    kind: script.kind as SharedScriptKind,
    targets: parseTargets(script.targetsJson),
    isActive: script.isActive,
    code: script.code,
    position: script.position,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    deletedAt: script.deletedAt,
  }
}

function parseTargets(value: string): SharedScriptTarget[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return ['pre-request']
    }

    const targets = parsed.filter((target): target is SharedScriptTarget =>
      typeof target === 'string' && SHARED_SCRIPT_TARGETS.includes(target as SharedScriptTarget)
    )

    return targets.length > 0 ? Array.from(new Set(targets)) : ['pre-request']
  } catch {
    return ['pre-request']
  }
}
