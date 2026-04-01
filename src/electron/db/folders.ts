import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createDefaultHttpAuth, parseHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateFolderInput,
  DeleteFolderResponse,
  DeleteFolderInput,
  FolderRecord,
  GetFolderInput,
  RenameFolderInput,
  UpdateFolderInput,
} from '../../common/Folders.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { folders, requestExamples, requests, treeItems, websocketExamples } from './schema.js'
import { insertOperation } from './operations.js'
import { ensureParentFolderExists, insertTreeItem } from './tree-items.js'

type FolderRow = typeof folders.$inferSelect

export async function createFolder(input: CreateFolderInput): Promise<GenericResult<FolderRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Folder name is required')
  }

  try {
    const folder = db.transaction(tx => {
      ensureParentFolderExists(tx, input.parentFolderId)

      const now = Date.now()
      const folder: FolderRow = {
        id: crypto.randomUUID(),
        parentId: input.parentFolderId,
        name,
        description: '',
        headers: '',
        authJson: serializeHttpAuth(createDefaultHttpAuth()),
        preRequestScript: '',
        postRequestScript: '',
        position: 0,
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(folders).values(folder).run()
      insertTreeItem(tx, { parentFolderId: input.parentFolderId, itemType: 'folder', itemId: folder.id })
      return folder
    })

    return Result.Success(toFolderRecord(folder))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function renameFolder(input: RenameFolderInput): Promise<GenericResult<void>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Folder name is required')
  }

  try {
    const result = db
      .update(folders)
      .set({ name })
      .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Folder not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getFolder(input: GetFolderInput): Promise<GenericResult<FolderRecord>> {
  const db = getDb()

  try {
    const folder = db
      .select()
      .from(folders)
      .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
      .get()

    if (!folder) {
      return GenericError.Message('Folder not found')
    }

    return Result.Success(toFolderRecord(folder))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateFolder(input: UpdateFolderInput): Promise<GenericResult<FolderRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Folder name is required')
  }

  try {
    const result = db
      .update(folders)
      .set({
        name,
        description: input.description,
        headers: input.headers,
        authJson: serializeHttpAuth(input.auth),
        preRequestScript: input.preRequestScript,
        postRequestScript: input.postRequestScript,
      })
      .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Folder not found')
    }

    const folder = db
      .select()
      .from(folders)
      .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
      .get()

    if (!folder) {
      return GenericError.Message('Folder not found')
    }

    return Result.Success(toFolderRecord(folder))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteFolder(input: DeleteFolderInput): Promise<GenericResult<DeleteFolderResponse>> {
  const db = getDb()

  try {
    const deleted = db.transaction(tx => {
      const rootFolder = tx
        .select({ id: folders.id, name: folders.name })
        .from(folders)
        .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
        .get()

      if (!rootFolder) {
        throw new Error('Folder not found')
      }

      const folderRows = tx
        .select({ id: folders.id, parentId: folders.parentId })
        .from(folders)
        .where(isNull(folders.deletedAt))
        .all()

      const subtreeFolderIds = new Set<string>([input.id])
      let changed = true
      while (changed) {
        changed = false
        folderRows.forEach(folder => {
          if (folder.parentId && subtreeFolderIds.has(folder.parentId) && !subtreeFolderIds.has(folder.id)) {
            subtreeFolderIds.add(folder.id)
            changed = true
          }
        })
      }

      const folderIds = Array.from(subtreeFolderIds)
      const requestIds = tx
        .select({ itemId: treeItems.itemId })
        .from(treeItems)
        .where(and(eq(treeItems.itemType, 'request'), inArray(treeItems.parentFolderId, folderIds), isNull(treeItems.deletedAt)))
        .all()
        .map(row => row.itemId)

      const now = Date.now()
      const operation = insertOperation(tx, {
        operationType: 'delete-folder',
        title: `Deleted folder ${rootFolder.name}`,
        summary: requestIds.length === 0 ? 'Folder deleted.' : `Deleted folder and ${requestIds.length} request${requestIds.length === 1 ? '' : 's'}.`,
        createdAt: now,
        metadata: {
          rootItemType: 'folder',
          rootItemId: rootFolder.id,
          rootItemName: rootFolder.name,
          deletedAt: now,
          folderIds,
          requestIds,
        },
      })

      tx.update(folders)
        .set({ deletedAt: now })
        .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)))
        .run()

      tx.update(treeItems)
        .set({ deletedAt: now })
        .where(
          and(
            isNull(treeItems.deletedAt),
            inArray(treeItems.itemType, ['folder', 'request']),
            inArray(treeItems.itemId, [...folderIds, ...requestIds])
          )
        )
        .run()

      if (requestIds.length > 0) {
        tx.update(requests)
          .set({ deletedAt: now })
          .where(and(inArray(requests.id, requestIds), isNull(requests.deletedAt)))
          .run()

        tx.update(requestExamples)
          .set({ deletedAt: now })
          .where(and(inArray(requestExamples.requestId, requestIds), isNull(requestExamples.deletedAt)))
          .run()

        tx.update(websocketExamples)
          .set({ deletedAt: now })
          .where(and(inArray(websocketExamples.requestId, requestIds), isNull(websocketExamples.deletedAt)))
          .run()
      }

      return { operation }
    })

    return Result.Success(deleted)
  } catch (error) {
    if (error instanceof Error && error.message === 'Folder not found') {
      return GenericError.Message(error.message)
    }
    return GenericError.Unknown(error)
  }
}

export async function getFolderAncestorChain(folderId: string | null): Promise<FolderRecord[]> {
  if (!folderId) {
    return []
  }

  const db = getDb()
  const foldersById = new Map<string, FolderRow>()
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    const folder = db
      .select()
      .from(folders)
      .where(and(eq(folders.id, currentFolderId), isNull(folders.deletedAt)))
      .get()

    if (!folder || folder.deletedAt !== null) {
      break
    }

    foldersById.set(folder.id, folder)
    currentFolderId = folder.parentId
  }

  return Array.from(foldersById.values())
    .reverse()
    .map(toFolderRecord)
}

function toFolderRecord(folder: FolderRow): FolderRecord {
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description,
    headers: folder.headers,
    auth: parseHttpAuth(folder.authJson),
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
    createdAt: folder.createdAt,
    deletedAt: folder.deletedAt,
  }
}
