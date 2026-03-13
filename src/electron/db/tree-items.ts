import { and, eq, isNull } from 'drizzle-orm'
import type { MoveExplorerItemInput } from '../../common/Explorer.js'
import { GenericError } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
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

export async function moveExplorerItem(input: MoveExplorerItemInput) {
  const db = getDb()

  if (input.targetPosition < 0) {
    return GenericError.Message('Invalid target position')
  }

  try {
    db.transaction(tx => {
      const currentItem = tx
        .select({
          rowId: treeItems.id,
          parentFolderId: treeItems.parentFolderId,
        })
        .from(treeItems)
        .where(and(eq(treeItems.itemType, input.itemType), eq(treeItems.itemId, input.id), isNull(treeItems.deletedAt)))
        .get()

      if (!currentItem) {
        throw new Error(`${input.itemType === 'folder' ? 'Folder' : 'Request'} not found`)
      }

      ensureParentFolderExists(tx, input.targetParentFolderId)

      if (input.itemType === 'folder') {
        if (input.targetParentFolderId === input.id) {
          throw new Error('Folder cannot be moved into itself')
        }

        if (input.targetParentFolderId) {
          let currentParentId: string | null = input.targetParentFolderId

          while (currentParentId) {
            if (currentParentId === input.id) {
              throw new Error('Folder cannot be moved into one of its descendants')
            }

            currentParentId =
              tx
                .select({ parentId: folders.parentId })
                .from(folders)
                .where(and(eq(folders.id, currentParentId), isNull(folders.deletedAt)))
                .get()?.parentId ?? null
          }
        }
      }

      const currentSiblings = tx
        .select({
          rowId: treeItems.id,
          itemType: treeItems.itemType,
          itemId: treeItems.itemId,
        })
        .from(treeItems)
        .where(buildTreeParentFilter(currentItem.parentFolderId))
        .orderBy(treeItems.position, treeItems.createdAt)
        .all()

      const remainingCurrentSiblings = currentSiblings.filter(sibling => sibling.rowId !== currentItem.rowId)

      const isSameParent = currentItem.parentFolderId === input.targetParentFolderId
      const targetSiblings = isSameParent
        ? remainingCurrentSiblings
        : tx
            .select({
              rowId: treeItems.id,
              itemType: treeItems.itemType,
              itemId: treeItems.itemId,
            })
            .from(treeItems)
            .where(buildTreeParentFilter(input.targetParentFolderId))
            .orderBy(treeItems.position, treeItems.createdAt)
            .all()

      const targetPosition = Math.min(input.targetPosition, targetSiblings.length)
      const movedSibling = {
        rowId: currentItem.rowId,
        itemType: input.itemType,
        itemId: input.id,
      }
      const nextTargetSiblings = targetSiblings.slice()
      nextTargetSiblings.splice(targetPosition, 0, movedSibling)

      reindexSiblings(tx, currentItem.parentFolderId, remainingCurrentSiblings)

      tx.update(treeItems)
        .set({
          parentFolderId: input.targetParentFolderId,
          position: targetPosition,
        })
        .where(eq(treeItems.id, currentItem.rowId))
        .run()

      if (input.itemType === 'folder') {
        tx.update(folders)
          .set({ parentId: input.targetParentFolderId })
          .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
          .run()
      }

      reindexSiblings(tx, input.targetParentFolderId, nextTargetSiblings)
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function reindexSiblings(
  db: Db,
  parentFolderId: string | null,
  siblings: Array<{ rowId: string; itemType: string; itemId: string }>
) {
  siblings.forEach((sibling, index) => {
    db.update(treeItems)
      .set({
        parentFolderId,
        position: index,
      })
      .where(eq(treeItems.id, sibling.rowId))
      .run()
  })
}
