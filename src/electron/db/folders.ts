import { and, eq, isNull, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateFolderInput,
  DeleteFolderInput,
  FolderRecord,
  GetFolderInput,
  RenameFolderInput,
  UpdateFolderInput,
} from '../../common/Folders.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { folders, requests, treeItems } from './schema.js'
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

export async function deleteFolder(input: DeleteFolderInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const now = Date.now()
    const folderResult = db.run(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT ${folders.id}
        FROM ${folders}
        WHERE ${folders.id} = ${input.id} AND ${folders.deletedAt} IS NULL
        UNION ALL
        SELECT child.id
        FROM folders AS child
        INNER JOIN subtree ON child.parent_id = subtree.id
        WHERE child.deleted_at IS NULL
      )
      UPDATE ${folders}
      SET ${folders.deletedAt} = ${now}
      WHERE ${folders.id} IN (SELECT id FROM subtree)
    `)

    if (folderResult.changes === 0) {
      return GenericError.Message('Folder not found')
    }

    db.run(sql`
      WITH RECURSIVE subtree(id) AS (
        SELECT ${folders.id}
        FROM ${folders}
        WHERE ${folders.id} = ${input.id}
        UNION ALL
        SELECT child.id
        FROM ${folders} AS child
        INNER JOIN subtree ON child.parent_id = subtree.id
        WHERE child.deleted_at IS NULL
      )
      UPDATE ${treeItems}
      SET ${treeItems.deletedAt} = ${now}
      WHERE ${treeItems.deletedAt} IS NULL
        AND (
          (${treeItems.itemType} = 'folder' AND ${treeItems.itemId} IN (SELECT id FROM subtree))
          OR (${treeItems.itemType} = 'request' AND ${treeItems.parentFolderId} IN (SELECT id FROM subtree))
        )
    `)

    db.run(sql`
      UPDATE ${requests}
      SET ${requests.deletedAt} = ${now}
      WHERE ${requests.deletedAt} IS NULL
        AND ${requests.id} IN (
          SELECT ${treeItems.itemId}
          FROM ${treeItems}
          WHERE ${treeItems.itemType} = 'request'
            AND ${treeItems.deletedAt} = ${now}
        )
    `)

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toFolderRecord(folder: FolderRow): FolderRecord {
  return {
    id: folder.id,
    name: folder.name,
    description: folder.description,
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
    createdAt: folder.createdAt,
    deletedAt: folder.deletedAt,
  }
}
