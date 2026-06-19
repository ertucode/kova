import { and, desc, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import {
  VIEW_LAYOUT_MODES,
  type CreateViewInput,
  type DeleteViewInput,
  type MoveViewInput,
  type UpdateViewInput,
  type ViewLayoutMode,
  type ViewRecord,
  type ViewShortcut,
} from '../../common/Views.js'
import { getDb } from './index.js'
import { views } from './schema.js'
import { clearViewCacheEntries } from './view-cache.js'

type ViewRow = typeof views.$inferSelect

const DEFAULT_VIEW_LAYOUT_MODE: ViewLayoutMode = 'horizontal'
const DEFAULT_VIEW_SPLIT_RATIO = 50
const MIN_VIEW_SPLIT_RATIO = 15
const MAX_VIEW_SPLIT_RATIO = 85

export async function listViews(): Promise<ViewRecord[]> {
  const db = getDb()

  return db
    .select()
    .from(views)
    .where(isNull(views.deletedAt))
    .orderBy(views.position, desc(views.createdAt))
    .all()
    .map(toViewRecord)
}

export async function getView(id: string): Promise<ViewRecord | null> {
  const db = getDb()
  const row = db.select().from(views).where(and(eq(views.id, id), isNull(views.deletedAt))).get()
  return row ? toViewRecord(row) : null
}

export async function createView(input: CreateViewInput): Promise<GenericResult<ViewRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('View name is required')
  }

  const layoutMode = normalizeViewLayoutMode(input.layoutMode)
  const splitRatio = normalizeViewSplitRatio(input.splitRatio)

  try {
    const duplicate = getActiveViewByName(db, name)
    if (duplicate) {
      return GenericError.Message(`View name ${name} is already used`)
    }

    const now = Date.now()
    const view: ViewRow = {
      id: crypto.randomUUID(),
      name,
      code: input.code ?? '',
      shortcutJson: serializeViewShortcut(input.shortcut ?? null),
      showCodeEditor: input.showCodeEditor ?? true,
      showRuntimePreview: input.showRuntimePreview ?? true,
      layoutMode,
      splitRatio,
      rememberRequests: input.rememberRequests ?? false,
      position: getNextViewPosition(db),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }

    db.insert(views).values(view).run()
    return Result.Success(toViewRecord(view))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateView(input: UpdateViewInput): Promise<GenericResult<ViewRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('View name is required')
  }

  if (!VIEW_LAYOUT_MODES.includes(input.layoutMode)) {
    return GenericError.Message('Invalid view layout mode')
  }

  const splitRatio = normalizeViewSplitRatio(input.splitRatio)

  try {
    const existing = db.select().from(views).where(and(eq(views.id, input.id), isNull(views.deletedAt))).get()
    if (!existing) {
      return GenericError.Message('View not found')
    }

    const duplicate = getActiveViewByName(db, name, input.id)
    if (duplicate) {
      return GenericError.Message(`View name ${name} is already used`)
    }

    db.update(views)
      .set({
        name,
        code: input.code,
        shortcutJson: serializeViewShortcut(input.shortcut),
        showCodeEditor: input.showCodeEditor,
        showRuntimePreview: input.showRuntimePreview,
        layoutMode: input.layoutMode,
        splitRatio,
        rememberRequests: input.rememberRequests,
        updatedAt: Date.now(),
      })
      .where(and(eq(views.id, input.id), isNull(views.deletedAt)))
      .run()

    const updated = db.select().from(views).where(and(eq(views.id, input.id), isNull(views.deletedAt))).get()
    if (!updated) {
      return GenericError.Message('View not found')
    }

    return Result.Success(toViewRecord(updated))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteView(input: DeleteViewInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const result = db.transaction(tx => {
      const deletedAt = Date.now()
      const deletionResult = tx
        .update(views)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(eq(views.id, input.id), isNull(views.deletedAt)))
        .run()

      if (deletionResult.changes === 0) {
        return deletionResult
      }

      clearViewCacheEntries(input.id, tx)
      return deletionResult
    })

    if (result.changes === 0) {
      return GenericError.Message('View not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function moveView(input: MoveViewInput): Promise<GenericResult<void>> {
  const db = getDb()
  if (input.targetPosition < 0) {
    return GenericError.Message('Invalid target position')
  }

  try {
    db.transaction(tx => {
      const rows = tx
        .select({ id: views.id })
        .from(views)
        .where(isNull(views.deletedAt))
        .orderBy(views.position, desc(views.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('View not found')
      }

      const [current] = rows.splice(currentIndex, 1)
      rows.splice(Math.max(0, Math.min(input.targetPosition, rows.length)), 0, current)

      rows.forEach((row, index) => {
        tx.update(views).set({ position: index, updatedAt: Date.now() }).where(eq(views.id, row.id)).run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error && error.message === 'View not found') {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

function getActiveViewByName(db: ReturnType<typeof getDb>, name: string, excludeId?: string) {
  const rows = db.select().from(views).where(isNull(views.deletedAt)).all()
  return rows.find(row => row.name === name && row.id !== excludeId) ?? null
}

function getNextViewPosition(db: ReturnType<typeof getDb>) {
  const rows = db.select({ position: views.position }).from(views).where(isNull(views.deletedAt)).all()
  if (rows.length === 0) {
    return 0
  }

  return Math.max(...rows.map(row => row.position)) + 1
}

function normalizeViewLayoutMode(value: ViewLayoutMode | undefined): ViewLayoutMode {
  return value && VIEW_LAYOUT_MODES.includes(value) ? value : DEFAULT_VIEW_LAYOUT_MODE
}

function normalizeViewSplitRatio(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_VIEW_SPLIT_RATIO
  }

  return Math.max(MIN_VIEW_SPLIT_RATIO, Math.min(MAX_VIEW_SPLIT_RATIO, Math.round(value)))
}

function toViewRecord(row: ViewRow): ViewRecord {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    shortcut: parseViewShortcut(row.shortcutJson),
    showCodeEditor: row.showCodeEditor ?? true,
    showRuntimePreview: row.showRuntimePreview ?? true,
    layoutMode: row.layoutMode as ViewLayoutMode,
    splitRatio: row.splitRatio,
    rememberRequests: row.rememberRequests,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}

function parseViewShortcut(value: string | null): ViewShortcut | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    const shortcut = parsed as Record<string, unknown>
    if (typeof shortcut.code !== 'string' || shortcut.code.length === 0) {
      return null
    }

    if (!isOptionalBoolean(shortcut.metaKey)) {
      return null
    }

    if (!isOptionalBoolean(shortcut.shiftKey)) {
      return null
    }

    if (!isOptionalBoolean(shortcut.ctrlKey)) {
      return null
    }

    if (!isOptionalBoolean(shortcut.altKey)) {
      return null
    }

    return {
      code: shortcut.code,
      metaKey: shortcut.metaKey,
      shiftKey: shortcut.shiftKey,
      ctrlKey: shortcut.ctrlKey,
      altKey: shortcut.altKey,
    }
  } catch {
    return null
  }
}

function serializeViewShortcut(shortcut: ViewShortcut | null): string | null {
  if (!shortcut) {
    return null
  }

  const normalizedShortcut = normalizeViewShortcut(shortcut)
  if (!normalizedShortcut) {
    return null
  }

  return JSON.stringify(normalizedShortcut)
}

function normalizeViewShortcut(shortcut: ViewShortcut): ViewShortcut | null {
  const code = shortcut.code.trim()
  if (!code) {
    return null
  }

  return {
    code,
    metaKey: shortcut.metaKey || undefined,
    shiftKey: shortcut.shiftKey || undefined,
    ctrlKey: shortcut.ctrlKey || undefined,
    altKey: shortcut.altKey || undefined,
  }
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}
