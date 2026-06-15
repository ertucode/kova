import { and, asc, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  DeleteViewCacheEntryInput,
  GetViewCacheEntryInput,
  ListViewCacheEntriesInput,
  SetViewCacheEntryInput,
  ViewCacheEntryRecord,
} from '../../common/ViewCache.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { viewCacheEntries, views } from './schema.js'

type ViewCacheEntryRow = typeof viewCacheEntries.$inferSelect

export async function listViewCacheEntries(input: ListViewCacheEntriesInput): Promise<GenericResult<ViewCacheEntryRecord[]>> {
  const db = getDb()

  try {
    ensureViewExists(db, input.viewId)

    const rows = db
      .select()
      .from(viewCacheEntries)
      .where(eq(viewCacheEntries.viewId, input.viewId))
      .orderBy(asc(viewCacheEntries.key), asc(viewCacheEntries.createdAt))
      .all()

    return Result.Success(rows.map(toViewCacheEntryRecord))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getViewCacheEntry(input: GetViewCacheEntryInput): Promise<GenericResult<ViewCacheEntryRecord | null>> {
  const db = getDb()
  const normalizedKey = normalizeCacheKey(input.key)
  if (!normalizedKey) {
    return GenericError.Message('View cache key is required')
  }

  try {
    ensureViewExists(db, input.viewId)

    const row = db
      .select()
      .from(viewCacheEntries)
      .where(and(eq(viewCacheEntries.viewId, input.viewId), eq(viewCacheEntries.key, normalizedKey)))
      .get()

    return Result.Success(row ? toViewCacheEntryRecord(row) : null)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function setViewCacheEntry(input: SetViewCacheEntryInput): Promise<GenericResult<ViewCacheEntryRecord>> {
  const db = getDb()
  const normalizedKey = normalizeCacheKey(input.key)
  if (!normalizedKey) {
    return GenericError.Message('View cache key is required')
  }

  try {
    ensureViewExists(db, input.viewId)

    const now = Date.now()
    const row: ViewCacheEntryRow = {
      id: crypto.randomUUID(),
      viewId: input.viewId,
      key: normalizedKey,
      value: input.value,
      createdAt: now,
      updatedAt: now,
    }

    db.insert(viewCacheEntries)
      .values(row)
      .onConflictDoUpdate({
        target: [viewCacheEntries.viewId, viewCacheEntries.key],
        set: {
          value: input.value,
          updatedAt: now,
        },
      })
      .run()

    const saved = db
      .select()
      .from(viewCacheEntries)
      .where(and(eq(viewCacheEntries.viewId, input.viewId), eq(viewCacheEntries.key, normalizedKey)))
      .get()
    if (!saved) {
      throw new Error('View cache entry not found after upsert')
    }

    return Result.Success(toViewCacheEntryRecord(saved))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteViewCacheEntry(input: DeleteViewCacheEntryInput): Promise<GenericResult<void>> {
  const db = getDb()
  const normalizedKey = normalizeCacheKey(input.key)
  if (!normalizedKey) {
    return GenericError.Message('View cache key is required')
  }

  try {
    ensureViewExists(db, input.viewId)

    db
      .delete(viewCacheEntries)
      .where(and(eq(viewCacheEntries.viewId, input.viewId), eq(viewCacheEntries.key, normalizedKey)))
      .run()

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function clearViewCacheEntries(viewId: string, db: ReturnType<typeof getDb> = getDb()) {
  db.delete(viewCacheEntries).where(eq(viewCacheEntries.viewId, viewId)).run()
}

function ensureViewExists(db: ReturnType<typeof getDb>, viewId: string) {
  const view = db.select({ id: views.id }).from(views).where(and(eq(views.id, viewId), isNull(views.deletedAt))).get()
  if (!view) {
    throw new Error('View not found')
  }
}

function normalizeCacheKey(value: string) {
  return value.trim()
}

function toViewCacheEntryRecord(row: ViewCacheEntryRow): ViewCacheEntryRecord {
  return {
    id: row.id,
    viewId: row.viewId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
