import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import type {
  CreateTagInput,
  DeleteTagInput,
  MoveTagInput,
  ReplaceItemTagsInput,
  ReplaceTagItemsInput,
  TagAssignmentRecord,
  TagRecord,
  TaggableItemType,
  UpdateTagInput,
} from '../../common/Tags.js'
import { normalizeTagColor } from '../../common/Tags.js'
import { getDb } from './index.js'
import { folders, requests, tagAssignments, tags } from './schema.js'

type TagRow = typeof tags.$inferSelect
type TagAssignmentRow = typeof tagAssignments.$inferSelect

const TAGGABLE_ITEM_TYPES: TaggableItemType[] = ['folder', 'request']

export async function listTags(): Promise<TagRecord[]> {
  const db = getDb()
  return db
    .select()
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(tags.position, desc(tags.createdAt))
    .all()
    .map(toTagRecord)
}

export async function listTagAssignments(): Promise<TagAssignmentRecord[]> {
  const db = getDb()
  return db
    .select({
      id: tagAssignments.id,
      tagId: tagAssignments.tagId,
      itemType: tagAssignments.itemType,
      itemId: tagAssignments.itemId,
      createdAt: tagAssignments.createdAt,
    })
    .from(tagAssignments)
    .innerJoin(tags, eq(tags.id, tagAssignments.tagId))
    .where(isNull(tags.deletedAt))
    .orderBy(tagAssignments.createdAt)
    .all()
    .map(toTagAssignmentRecord)
}

export async function createTag(input: CreateTagInput): Promise<GenericResult<TagRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Tag name is required')
  }

  try {
    const existing = getActiveTagByName(db, name)
    if (existing) {
      return GenericError.Message(`Tag name ${name} is already used`)
    }

    const now = Date.now()
    const tag: TagRow = {
      id: crypto.randomUUID(),
      name,
      color: normalizeTagColor(input.color),
      position: getNextTagPosition(db),
      createdAt: now,
      deletedAt: null,
    }

    db.insert(tags).values(tag).run()
    return Result.Success(toTagRecord(tag))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateTag(input: UpdateTagInput): Promise<GenericResult<TagRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Tag name is required')
  }

  try {
    const existing = db.select().from(tags).where(and(eq(tags.id, input.id), isNull(tags.deletedAt))).get()
    if (!existing) {
      return GenericError.Message('Tag not found')
    }

    const duplicate = getActiveTagByName(db, name, input.id)
    if (duplicate) {
      return GenericError.Message(`Tag name ${name} is already used`)
    }

    db.update(tags)
      .set({ name, color: normalizeTagColor(input.color) })
      .where(and(eq(tags.id, input.id), isNull(tags.deletedAt)))
      .run()

    const updated = db.select().from(tags).where(and(eq(tags.id, input.id), isNull(tags.deletedAt))).get()
    if (!updated) {
      return GenericError.Message('Tag not found')
    }

    return Result.Success(toTagRecord(updated))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteTag(input: DeleteTagInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    db.transaction(tx => {
      const result = tx.update(tags).set({ deletedAt: Date.now() }).where(and(eq(tags.id, input.id), isNull(tags.deletedAt))).run()
      if (result.changes === 0) {
        throw new Error('Tag not found')
      }

      tx.delete(tagAssignments).where(eq(tagAssignments.tagId, input.id)).run()
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

export async function moveTag(input: MoveTagInput): Promise<GenericResult<void>> {
  const db = getDb()
  if (input.targetPosition < 0) {
    return GenericError.Message('Invalid target position')
  }

  try {
    db.transaction(tx => {
      const rows = tx
        .select({ id: tags.id })
        .from(tags)
        .where(isNull(tags.deletedAt))
        .orderBy(tags.position, desc(tags.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('Tag not found')
      }

      const [current] = rows.splice(currentIndex, 1)
      rows.splice(Math.max(0, Math.min(input.targetPosition, rows.length)), 0, current)

      rows.forEach((row, index) => {
        tx.update(tags).set({ position: index }).where(eq(tags.id, row.id)).run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

export async function replaceItemTags(input: ReplaceItemTagsInput): Promise<GenericResult<void>> {
  const db = getDb()

  if (!TAGGABLE_ITEM_TYPES.includes(input.itemType)) {
    return GenericError.Message('Unsupported item type')
  }

  try {
    db.transaction(tx => {
      ensureItemExists(tx, input.itemType, input.itemId)
      const activeTagIds = getValidatedTagIds(tx, input.tagIds)

      tx.delete(tagAssignments)
        .where(and(eq(tagAssignments.itemType, input.itemType), eq(tagAssignments.itemId, input.itemId)))
        .run()

      activeTagIds.forEach(tagId => {
        tx.insert(tagAssignments)
          .values({
            id: crypto.randomUUID(),
            tagId,
            itemType: input.itemType,
            itemId: input.itemId,
            createdAt: Date.now(),
          })
          .run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

export async function replaceTagItems(input: ReplaceTagItemsInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    db.transaction(tx => {
      const tag = tx.select({ id: tags.id }).from(tags).where(and(eq(tags.id, input.tagId), isNull(tags.deletedAt))).get()
      if (!tag) {
        throw new Error('Tag not found')
      }

      const dedupedItems = Array.from(new Map(
        input.items
          .filter(item => TAGGABLE_ITEM_TYPES.includes(item.itemType))
          .map(item => [`${item.itemType}:${item.itemId}`, item])
      ).values())

      dedupedItems.forEach(item => ensureItemExists(tx, item.itemType, item.itemId))

      tx.delete(tagAssignments).where(eq(tagAssignments.tagId, input.tagId)).run()

      dedupedItems.forEach(item => {
        tx.insert(tagAssignments)
          .values({
            id: crypto.randomUUID(),
            tagId: input.tagId,
            itemType: item.itemType,
            itemId: item.itemId,
            createdAt: Date.now(),
          })
          .run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message)
    }

    return GenericError.Unknown(error)
  }
}

function toTagRecord(row: TagRow): TagRecord {
  return {
    id: row.id,
    name: row.name,
    color: normalizeTagColor(row.color),
    position: row.position,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }
}

function toTagAssignmentRecord(row: Pick<TagAssignmentRow, 'id' | 'tagId' | 'itemType' | 'itemId' | 'createdAt'>): TagAssignmentRecord {
  return {
    id: row.id,
    tagId: row.tagId,
    itemType: row.itemType as TaggableItemType,
    itemId: row.itemId,
    createdAt: row.createdAt,
  }
}

function getActiveTagByName(db: ReturnType<typeof getDb>, name: string, excludeId?: string) {
  const rows = db.select().from(tags).where(isNull(tags.deletedAt)).all()
  return rows.find(row => row.name === name && row.id !== excludeId) ?? null
}

function getNextTagPosition(db: ReturnType<typeof getDb>) {
  const rows = db.select({ position: tags.position }).from(tags).where(isNull(tags.deletedAt)).all()
  if (rows.length === 0) {
    return 0
  }

  return Math.max(...rows.map(row => row.position)) + 1
}

function getValidatedTagIds(db: ReturnType<typeof getDb>, tagIds: string[]) {
  const dedupedTagIds = Array.from(new Set(tagIds))
  if (dedupedTagIds.length === 0) {
    return dedupedTagIds
  }

  const activeTags = db
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, dedupedTagIds), isNull(tags.deletedAt)))
    .all()
    .map(row => row.id)

  if (activeTags.length !== dedupedTagIds.length) {
    throw new Error('One or more tags were not found')
  }

  return dedupedTagIds
}

function ensureItemExists(db: ReturnType<typeof getDb>, itemType: TaggableItemType, itemId: string) {
  const exists =
    itemType === 'folder'
      ? db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, itemId), isNull(folders.deletedAt))).get()
      : db.select({ id: requests.id }).from(requests).where(and(eq(requests.id, itemId), isNull(requests.deletedAt))).get()

  if (!exists) {
    throw new Error(itemType === 'folder' ? 'Folder not found' : 'Request not found')
  }
}
