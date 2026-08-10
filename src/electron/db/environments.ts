import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  DuplicateEnvironmentInput,
  EnvironmentRecord,
  MoveEnvironmentInput,
  UpdateEnvironmentInput,
} from '../../common/Environments.js'
import { normalizeEnvironmentColor } from '../../common/Environments.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { environments, folders } from './schema.js'

type EnvironmentRow = typeof environments.$inferSelect

export async function listEnvironments(): Promise<EnvironmentRecord[]> {
  const db = getDb()

  return db
    .select()
    .from(environments)
    .where(isNull(environments.deletedAt))
    .orderBy(environments.position, desc(environments.createdAt))
    .all()
    .map(toEnvironmentRecord)
}

export async function listVisibleEnvironments(input: {
  folderId: string | null
  activeEnvironmentIds: string[]
}): Promise<EnvironmentRecord[]> {
  const db = getDb()
  const visibleFolderIds = await resolveVisibleFolderIds(input.folderId)
  const rows = db
    .select()
    .from(environments)
    .where(
      and(
        isNull(environments.deletedAt),
        or(
          input.activeEnvironmentIds.length > 0
            ? and(isNull(environments.folderId), inArray(environments.id, input.activeEnvironmentIds))
            : and(isNull(environments.folderId), eq(environments.id, '__no_workspace_environment__')),
          visibleFolderIds.length > 0
            ? inArray(environments.folderId, visibleFolderIds)
            : eq(environments.id, '__no_folder_environment__')
        )
      )
    )
    .all()
    .map(toEnvironmentRecord)

  const folderById = new Map(visibleFolderIds.map((folderId, index) => [folderId, visibleFolderIds.length - index]))
  return rows.sort((left, right) => {
    const leftSpecificity = left.folderId ? (folderById.get(left.folderId) ?? 0) : -1
    const rightSpecificity = right.folderId ? (folderById.get(right.folderId) ?? 0) : -1
    if (leftSpecificity !== rightSpecificity) {
      return rightSpecificity - leftSpecificity
    }

    return right.priority - left.priority || right.createdAt - left.createdAt
  })
}

export async function getEnvironmentsByIds(ids: string[]): Promise<EnvironmentRecord[]> {
  if (ids.length === 0) {
    return []
  }

  const db = getDb()
  return db
    .select()
    .from(environments)
    .where(and(inArray(environments.id, ids), isNull(environments.deletedAt)))
    .all()
    .map(toEnvironmentRecord)
}

export async function createEnvironment(input: CreateEnvironmentInput): Promise<GenericResult<EnvironmentRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Environment name is required')
  }

  try {
    const now = Date.now()
      const environment: EnvironmentRow = {
        id: crypto.randomUUID(),
        name,
        folderId: input.folderId ?? null,
        variables: '',
        color: null,
        warnOnRequest: false,
        position: getNextEnvironmentPosition(db, input.folderId ?? null),
        priority: 0,
        createdAt: now,
        deletedAt: null,
    }

    db.insert(environments).values(environment).run()
    return Result.Success(toEnvironmentRecord(environment))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateEnvironment(input: UpdateEnvironmentInput): Promise<GenericResult<EnvironmentRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Environment name is required')
  }

  if (!Number.isInteger(input.priority)) {
    return GenericError.Message('Environment priority must be an integer')
  }

  try {
    const result = db
      .update(environments)
      .set({
        name,
        variables: input.variables,
        color: normalizeEnvironmentColor(input.color),
        warnOnRequest: input.warnOnRequest,
        priority: input.priority,
      })
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Environment not found')
    }

    const environment = db
      .select()
      .from(environments)
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .get()

    if (!environment || environment.deletedAt !== null) {
      return GenericError.Message('Environment not found')
    }

    return Result.Success(toEnvironmentRecord(environment))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function duplicateEnvironment(input: DuplicateEnvironmentInput): Promise<GenericResult<EnvironmentRecord>> {
  const db = getDb()

  try {
    const source = db
      .select()
      .from(environments)
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .get()

    if (!source) {
      return GenericError.Message('Environment not found')
    }

    const now = Date.now()
    const environment: EnvironmentRow = {
      ...source,
      id: crypto.randomUUID(),
      name: buildDuplicateEnvironmentName(db, source.name, source.folderId),
      position: getNextEnvironmentPosition(db, source.folderId),
      createdAt: now,
      deletedAt: null,
    }

    db.insert(environments).values(environment).run()
    return Result.Success(toEnvironmentRecord(environment))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteEnvironment(input: DeleteEnvironmentInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const result = db
      .update(environments)
      .set({ deletedAt: Date.now() })
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Environment not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function moveEnvironment(input: MoveEnvironmentInput): Promise<GenericResult<void>> {
  const db = getDb()

  if (input.targetPosition < 0) {
    return GenericError.Message('Invalid target position')
  }

  try {
    const currentEnvironment = db
      .select({ folderId: environments.folderId })
      .from(environments)
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .get()

    if (!currentEnvironment) {
      return GenericError.Message('Environment not found')
    }

    const result = db.transaction(tx => {
      const rows = tx
        .select({ id: environments.id })
        .from(environments)
        .where(and(buildScopeFilter(currentEnvironment.folderId), isNull(environments.deletedAt)))
        .orderBy(environments.position, desc(environments.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('Environment not found')
      }

      const [current] = rows.splice(currentIndex, 1)
      const targetIndex = Math.max(0, Math.min(input.targetPosition, rows.length))
      rows.splice(targetIndex, 0, current)

      rows.forEach((row, index) => {
        tx.update(environments).set({ position: index }).where(eq(environments.id, row.id)).run()
      })
    })

    return Result.Success(result)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateEnvironmentVariables(input: { id: string; variables: string }) {
  const db = getDb()

  const environment = db
    .select()
    .from(environments)
    .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
    .get()

  if (!environment || environment.deletedAt !== null) {
    throw new Error('Environment not found')
  }

  db.update(environments)
    .set({ variables: input.variables })
    .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
    .run()

  return toEnvironmentRecord({ ...environment, variables: input.variables })
}

function toEnvironmentRecord(environment: EnvironmentRow): EnvironmentRecord {
  return {
    id: environment.id,
    name: environment.name,
    folderId: environment.folderId,
    variables: environment.variables,
    color: normalizeEnvironmentColor(environment.color),
    warnOnRequest: environment.warnOnRequest,
    position: environment.position,
    priority: environment.priority,
    createdAt: environment.createdAt,
    deletedAt: environment.deletedAt,
  }
}

function getNextEnvironmentPosition(db: ReturnType<typeof getDb>, folderId: string | null) {
  const activeEnvironments = db
    .select({ position: environments.position })
    .from(environments)
    .where(and(buildScopeFilter(folderId), isNull(environments.deletedAt)))
    .all()

  if (activeEnvironments.length === 0) {
    return 0
  }

  return Math.max(...activeEnvironments.map(environment => environment.position)) + 1
}

function buildDuplicateEnvironmentName(db: ReturnType<typeof getDb>, sourceName: string, folderId: string | null) {
  const names = db
    .select({ name: environments.name })
    .from(environments)
    .where(and(buildScopeFilter(folderId), isNull(environments.deletedAt)))
    .all()
    .map(row => row.name)

  const baseName = sourceName.replace(/ \(\d+\)$/u, '')
  let index = 2
  while (names.includes(`${baseName} (${index})`)) {
    index += 1
  }

  return `${baseName} (${index})`
}

function buildScopeFilter(folderId: string | null) {
  return folderId === null ? isNull(environments.folderId) : eq(environments.folderId, folderId)
}

async function resolveVisibleFolderIds(folderId: string | null) {
  if (!folderId) {
    return []
  }

  const db = getDb()
  const visibleFolderIds: string[] = []
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    visibleFolderIds.unshift(currentFolderId)
    const folder = db
      .select({ parentId: folders.parentId })
      .from(folders)
      .where(and(eq(folders.id, currentFolderId), isNull(folders.deletedAt)))
      .get()
    currentFolderId = folder?.parentId ?? null
  }

  return visibleFolderIds
}
