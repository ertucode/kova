import { and, eq, isNull } from 'drizzle-orm'
import { GenericError } from '../../common/GenericError.js'
import { getDb } from './index.js'
import { folders, treeItems } from './schema.js'

type Db = ReturnType<typeof getDb>

export function ensureParentFolderExists(db: Db, parentFolderId: string | null) {
  if (!parentFolderId) {
    return
  }

  const folder = db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, parentFolderId), isNull(folders.deletedAt)))
    .get()

  if (!folder) {
    throw new Error('Parent folder not found')
  }
}

export function getNextTreePosition(db: Db, parentFolderId: string | null) {
  const siblings = db
    .select({ id: treeItems.id })
    .from(treeItems)
    .where(buildTreeParentFilter(parentFolderId))
    .all()

  return siblings.length
}

export function buildTreeParentFilter(parentFolderId: string | null) {
  return parentFolderId
    ? and(eq(treeItems.parentFolderId, parentFolderId), isNull(treeItems.deletedAt))
    : and(isNull(treeItems.parentFolderId), isNull(treeItems.deletedAt))
}

export function insertTreeItem(db: Db, input: { parentFolderId: string | null; itemType: 'folder' | 'request'; itemId: string }) {
  const now = Date.now()

  db.insert(treeItems)
    .values({
      id: crypto.randomUUID(),
      parentFolderId: input.parentFolderId,
      itemType: input.itemType,
      itemId: input.itemId,
      position: getNextTreePosition(db, input.parentFolderId),
      createdAt: now,
      deletedAt: null,
    })
    .run()
}

export function markTreeItemDeleted(db: Db, input: { itemType: 'folder' | 'request'; itemId: string; deletedAt: number }) {
  db.update(treeItems)
    .set({ deletedAt: input.deletedAt })
    .where(and(eq(treeItems.itemType, input.itemType), eq(treeItems.itemId, input.itemId), isNull(treeItems.deletedAt)))
    .run()
}

export function toGenericTreeError(error: unknown) {
  return GenericError.Unknown(error)
}
