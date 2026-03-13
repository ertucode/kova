import { and, eq, isNull, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateFolderInput,
  FolderListItem,
  DeleteFolderInput,
  FolderRecord,
  GetFolderInput,
  MoveFolderInput,
  RenameFolderInput,
  UpdateFolderInput,
} from '../../common/Folders.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { folders } from './schema.js'

type Db = ReturnType<typeof getDb>
type FolderRow = typeof folders.$inferSelect

export async function listFolders(): Promise<FolderListItem[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(folders)
    .where(isNull(folders.deletedAt))
    .orderBy(folders.parentId, folders.position, folders.createdAt)

  return rows.map(toFolderListItem)
}

export async function createFolder(input: CreateFolderInput): Promise<GenericResult<FolderRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Folder name is required')
  }

  try {
    const folder = db.transaction(tx => {
      if (input.parentId) {
        const parent = tx
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, input.parentId), isNull(folders.deletedAt)))
          .get()

        if (!parent) {
          throw new Error('Parent folder not found')
        }
      }

      const siblings = tx
        .select({ id: folders.id })
        .from(folders)
        .where(buildParentFilter(input.parentId))
        .orderBy(folders.position, folders.createdAt)
        .all()

      const now = Date.now()
      const folder: FolderRow = {
        id: crypto.randomUUID(),
        parentId: input.parentId,
        name,
        description: '',
        preRequestScript: '',
        postRequestScript: '',
        position: siblings.length,
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(folders).values(folder).run()
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
    const result = db.run(sql`
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

    if (result.changes === 0) {
      return GenericError.Message('Folder not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function moveFolder(input: MoveFolderInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    db.transaction(tx => {
      const folder = tx
        .select()
        .from(folders)
        .where(and(eq(folders.id, input.id), isNull(folders.deletedAt)))
        .get()

      if (!folder) {
        throw new Error('Folder not found')
      }

      if (input.parentId === input.id) {
        throw new Error('Folder cannot be moved into itself')
      }

      if (input.parentId) {
        const parent = tx
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, input.parentId), isNull(folders.deletedAt)))
          .get()

        if (!parent) {
          throw new Error('Target folder not found')
        }

        const cycle = tx.get<{ id: string }>(sql`
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
          SELECT id FROM subtree WHERE id = ${input.parentId} LIMIT 1
        `)

        if (cycle) {
          throw new Error('Folder cannot be moved into its own child')
        }
      }

      if (folder.parentId === input.parentId) {
        const siblingIds = getActiveSiblingIds(tx, input.parentId, folder.id)
        const nextSiblingIds = insertAtIndex(siblingIds, folder.id, input.position)
        writeSiblingPositions(tx, input.parentId, nextSiblingIds)
        return
      }

      const sourceSiblingIds = getActiveSiblingIds(tx, folder.parentId, folder.id)
      writeSiblingPositions(tx, folder.parentId, sourceSiblingIds)

      tx.update(folders)
        .set({ parentId: input.parentId, position: 0 })
        .where(eq(folders.id, folder.id))
        .run()

      const destinationSiblingIds = getActiveSiblingIds(tx, input.parentId, folder.id)
      const nextSiblingIds = insertAtIndex(destinationSiblingIds, folder.id, input.position)
      writeSiblingPositions(tx, input.parentId, nextSiblingIds)
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toFolderRecord(folder: FolderRow): FolderRecord {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    description: folder.description,
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
    position: folder.position,
    createdAt: folder.createdAt,
    deletedAt: folder.deletedAt,
  }
}

function toFolderListItem(folder: FolderRow): FolderListItem {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    position: folder.position,
    createdAt: folder.createdAt,
    deletedAt: folder.deletedAt,
  }
}

function buildParentFilter(parentId: string | null) {
  return parentId
    ? and(eq(folders.parentId, parentId), isNull(folders.deletedAt))
    : and(isNull(folders.parentId), isNull(folders.deletedAt))
}

function getActiveSiblingIds(db: Db, parentId: string | null, excludeId?: string) {
  const rows = db
    .select({ id: folders.id })
    .from(folders)
    .where(buildParentFilter(parentId))
    .orderBy(folders.position, folders.createdAt)
    .all()

  return rows.map(row => row.id).filter(id => id !== excludeId)
}

function insertAtIndex(ids: string[], id: string, position: number) {
  const nextIds = ids.filter(candidateId => candidateId !== id)
  const normalizedPosition = Math.max(0, Math.min(position, nextIds.length))
  nextIds.splice(normalizedPosition, 0, id)
  return nextIds
}

function writeSiblingPositions(db: Db, parentId: string | null, ids: string[]) {
  ids.forEach((id, position) => {
    db.update(folders)
      .set({ parentId, position })
      .where(eq(folders.id, id))
      .run()
  })
}
