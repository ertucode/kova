import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  DeleteExplorerItemsOperationMetadata,
  DeleteOperationInput,
  DeleteOperationsInput,
  ListOperationsInput,
  OperationMetadata,
  OperationRecord,
  OperationStatus,
  OperationType,
  UndoOperationInput,
  UndoOperationsInput,
} from '../../common/Operations.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import {
  folderExplorerTabs,
  operations,
  requestExamples,
  requestHistory,
  requests,
  treeItems,
  websocketExampleMessages,
  websocketExamples,
  websocketHistory,
  websocketHistoryMessages,
  websocketSavedMessages,
  folders,
} from './schema.js'

type Db = ReturnType<typeof getDb>
type OperationRow = typeof operations.$inferSelect

export function insertOperation(
  db: Db,
  input: {
    operationType: OperationType
    title: string
    summary: string
    metadata: OperationMetadata
    createdAt?: number
    status?: OperationStatus
  }
) {
  const now = input.createdAt ?? Date.now()
  const row: OperationRow = {
    id: crypto.randomUUID(),
    operationType: input.operationType,
    status: input.status ?? 'active',
    title: input.title,
    summary: input.summary,
    metadataJson: JSON.stringify(input.metadata),
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    undoneAt: null,
  }

  db.insert(operations).values(row).run()
  return toOperationRecord(row)
}

export async function listOperations(input?: ListOperationsInput): Promise<OperationRecord[]> {
  const db = getDb()
  const rows = db.select().from(operations).orderBy(desc(operations.createdAt), desc(operations.updatedAt)).all()
  const records = rows.map(toOperationRecord)
  const searchQuery = input?.searchQuery?.trim().toLowerCase() ?? ''
  const statuses = input?.statuses?.length ? new Set(input.statuses) : null

  return records.filter(record => {
    if (statuses && !statuses.has(record.status)) {
      return false
    }

    if (!searchQuery) {
      return true
    }

    return `${record.title} ${record.summary}`.toLowerCase().includes(searchQuery)
  })
}

export async function undoOperation(input: UndoOperationInput): Promise<GenericResult<OperationRecord>> {
  const db = getDb()

  try {
    const record = db.transaction(tx => {
      const row = tx.select().from(operations).where(eq(operations.id, input.id)).get()
      if (!row) {
        throw new Error('Operation not found')
      }

      const operation = toOperationRecord(row)
      if (operation.status !== 'active') {
        throw new Error('Operation cannot be undone')
      }

      if (operation.operationType === 'delete-folder' || operation.operationType === 'delete-request') {
        restoreExplorerDeleteOperation(tx, operation.metadata)
      } else {
        throw new Error('Unsupported operation type')
      }

      const undoneAt = Date.now()
      tx.update(operations)
        .set({ status: 'undone', updatedAt: undoneAt, undoneAt })
        .where(eq(operations.id, input.id))
        .run()

      const nextRow = tx.select().from(operations).where(eq(operations.id, input.id)).get()
      if (!nextRow) {
        throw new Error('Operation not found')
      }

      return toOperationRecord(nextRow)
    })

    return Result.Success(record)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function undoOperations(input: UndoOperationsInput): Promise<GenericResult<void>> {
  try {
    for (const id of input.ids) {
      const result = await undoOperation({ id })
      if (!result.success) {
        return Result.withoutData(result) as GenericResult<void>
      }
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteOperation(input: DeleteOperationInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    db.transaction(tx => {
      const row = tx.select().from(operations).where(eq(operations.id, input.id)).get()
      if (!row) {
        throw new Error('Operation not found')
      }

      const operation = toOperationRecord(row)
      if (operation.status === 'active') {
        if (operation.operationType === 'delete-folder' || operation.operationType === 'delete-request') {
          purgeExplorerDeleteOperation(tx, operation.metadata)
        } else {
          throw new Error('Unsupported operation type')
        }
      }

      tx.delete(operations).where(eq(operations.id, input.id)).run()
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteOperations(input: DeleteOperationsInput): Promise<GenericResult<void>> {
  try {
    for (const id of input.ids) {
      const result = await deleteOperation({ id })
      if (!result.success) {
        return Result.withoutData(result) as GenericResult<void>
      }
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function restoreExplorerDeleteOperation(db: Db, metadata: DeleteExplorerItemsOperationMetadata) {
  if (metadata.folderIds.length > 0) {
    db.update(folders)
      .set({ deletedAt: null })
      .where(and(inArray(folders.id, metadata.folderIds), eq(folders.deletedAt, metadata.deletedAt)))
      .run()
  }

  if (metadata.requestIds.length > 0) {
    db.update(requests)
      .set({ deletedAt: null })
      .where(and(inArray(requests.id, metadata.requestIds), eq(requests.deletedAt, metadata.deletedAt)))
      .run()

    db.update(requestExamples)
      .set({ deletedAt: null })
      .where(and(inArray(requestExamples.requestId, metadata.requestIds), eq(requestExamples.deletedAt, metadata.deletedAt)))
      .run()

    db.update(websocketExamples)
      .set({ deletedAt: null })
      .where(and(inArray(websocketExamples.requestId, metadata.requestIds), eq(websocketExamples.deletedAt, metadata.deletedAt)))
      .run()
  }

  const treePredicates = []
  if (metadata.folderIds.length > 0) {
    treePredicates.push(and(eq(treeItems.itemType, 'folder'), inArray(treeItems.itemId, metadata.folderIds)))
  }
  if (metadata.requestIds.length > 0) {
    treePredicates.push(and(eq(treeItems.itemType, 'request'), inArray(treeItems.itemId, metadata.requestIds)))
  }

  if (treePredicates.length > 0) {
    db.update(treeItems)
      .set({ deletedAt: null })
      .where(and(eq(treeItems.deletedAt, metadata.deletedAt), or(...treePredicates)!))
      .run()
  }
}

function purgeExplorerDeleteOperation(db: Db, metadata: DeleteExplorerItemsOperationMetadata) {
  if (metadata.requestIds.length > 0) {
    const websocketExampleIds = db.select({ id: websocketExamples.id })
      .from(websocketExamples)
      .where(inArray(websocketExamples.requestId, metadata.requestIds))
      .all()
      .map(row => row.id)

    const websocketHistoryIds = db.select({ id: websocketHistory.id })
      .from(websocketHistory)
      .where(inArray(websocketHistory.requestId, metadata.requestIds))
      .all()
      .map(row => row.id)

    if (websocketExampleIds.length > 0) {
      db.delete(websocketExampleMessages).where(inArray(websocketExampleMessages.exampleId, websocketExampleIds)).run()
    }

    if (websocketHistoryIds.length > 0) {
      db.delete(websocketHistoryMessages).where(inArray(websocketHistoryMessages.historyId, websocketHistoryIds)).run()
    }

    db.delete(websocketHistory).where(inArray(websocketHistory.requestId, metadata.requestIds)).run()
    db.delete(websocketSavedMessages).where(inArray(websocketSavedMessages.requestId, metadata.requestIds)).run()
    db.delete(requestHistory).where(inArray(requestHistory.requestId, metadata.requestIds)).run()
    db.delete(requestExamples).where(inArray(requestExamples.requestId, metadata.requestIds)).run()
    db.delete(websocketExamples).where(inArray(websocketExamples.requestId, metadata.requestIds)).run()
    db.delete(folderExplorerTabs)
      .where(and(eq(folderExplorerTabs.itemType, 'request'), inArray(folderExplorerTabs.itemId, metadata.requestIds)))
      .run()
    db.delete(treeItems)
      .where(and(eq(treeItems.itemType, 'request'), inArray(treeItems.itemId, metadata.requestIds)))
      .run()
    db.delete(requests).where(inArray(requests.id, metadata.requestIds)).run()
  }

  if (metadata.folderIds.length > 0) {
    db.delete(folderExplorerTabs)
      .where(and(eq(folderExplorerTabs.itemType, 'folder'), inArray(folderExplorerTabs.itemId, metadata.folderIds)))
      .run()
    db.delete(treeItems)
      .where(and(eq(treeItems.itemType, 'folder'), inArray(treeItems.itemId, metadata.folderIds)))
      .run()
    db.delete(folders).where(inArray(folders.id, metadata.folderIds)).run()
  }
}

function toOperationRecord(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    operationType: row.operationType as OperationType,
    status: row.status as OperationStatus,
    title: row.title,
    summary: row.summary,
    metadata: parseOperationMetadata(row.metadataJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    undoneAt: row.undoneAt,
  }
}

function parseOperationMetadata(metadataJson: string): OperationMetadata {
  const parsed = JSON.parse(metadataJson) as Partial<DeleteExplorerItemsOperationMetadata>
  if (
    (parsed.rootItemType !== 'folder' && parsed.rootItemType !== 'request') ||
    typeof parsed.rootItemId !== 'string' ||
    typeof parsed.rootItemName !== 'string' ||
    typeof parsed.deletedAt !== 'number' ||
    !Array.isArray(parsed.folderIds) ||
    !Array.isArray(parsed.requestIds)
  ) {
    throw new Error('Invalid operation metadata')
  }

  return {
    rootItemType: parsed.rootItemType,
    rootItemId: parsed.rootItemId,
    rootItemName: parsed.rootItemName,
    deletedAt: parsed.deletedAt,
    folderIds: parsed.folderIds.filter((value): value is string => typeof value === 'string'),
    requestIds: parsed.requestIds.filter((value): value is string => typeof value === 'string'),
  }
}
