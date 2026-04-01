import { and, asc, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import type {
  CreateWebSocketExampleInput,
  DeleteWebSocketExampleInput,
  GetWebSocketExampleInput,
  MoveWebSocketExampleInput,
  UpdateWebSocketExampleInput,
  WebSocketExampleMessageRecord,
  WebSocketExampleRecord,
} from '../../common/WebSocketExamples.js'
import { getDb } from './index.js'
import { requests, websocketExampleMessages, websocketExamples } from './schema.js'

type WebSocketExampleRow = typeof websocketExamples.$inferSelect
type WebSocketExampleMessageRow = typeof websocketExampleMessages.$inferSelect

export async function createWebSocketExample(input: CreateWebSocketExampleInput): Promise<GenericResult<WebSocketExampleRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('Example name is required')
  }

  try {
    const item = db.transaction(tx => {
      ensureRequestExists(tx, input.requestId)
      const position = getNextExamplePosition(tx, input.requestId)
      const now = Date.now()
      const row: WebSocketExampleRow = {
        id: crypto.randomUUID(),
        requestId: input.requestId,
        name,
        position,
        requestHeaders: input.requestHeaders,
        requestBody: input.requestBody,
        messageCount: input.messages.length,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
      tx.insert(websocketExamples).values(row).run()

      for (const message of input.messages) {
        const messageRow: WebSocketExampleMessageRow = {
          id: crypto.randomUUID(),
          exampleId: row.id,
          direction: message.direction,
          body: message.body,
          mimeType: message.mimeType,
          sizeBytes: message.sizeBytes,
          timestamp: message.timestamp,
          createdAt: now,
        }
        tx.insert(websocketExampleMessages).values(messageRow).run()
      }

      return row
    })

    return Result.Success(await getWebSocketExampleRecord(item.id))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getWebSocketExample(input: GetWebSocketExampleInput): Promise<GenericResult<WebSocketExampleRecord>> {
  try {
    return Result.Success(await getWebSocketExampleRecord(input.id))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateWebSocketExample(input: UpdateWebSocketExampleInput): Promise<GenericResult<WebSocketExampleRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('Example name is required')
  }

  try {
    const result = db
      .update(websocketExamples)
      .set({
        name,
        requestHeaders: input.requestHeaders,
        requestBody: input.requestBody,
        updatedAt: Date.now(),
      })
      .where(and(eq(websocketExamples.id, input.id), isNull(websocketExamples.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Example not found')
    }

    return Result.Success(await getWebSocketExampleRecord(input.id))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteWebSocketExample(input: DeleteWebSocketExampleInput): Promise<GenericResult<void>> {
  const db = getDb()
  try {
    const result = db
      .update(websocketExamples)
      .set({ deletedAt: Date.now() })
      .where(and(eq(websocketExamples.id, input.id), isNull(websocketExamples.deletedAt)))
      .run()
    if (result.changes === 0) {
      return GenericError.Message('Example not found')
    }
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function moveWebSocketExample(input: MoveWebSocketExampleInput): Promise<GenericResult<void>> {
  const db = getDb()
  try {
    db.transaction(tx => {
      const rows = tx
        .select()
        .from(websocketExamples)
        .where(and(eq(websocketExamples.requestId, input.requestId), isNull(websocketExamples.deletedAt)))
        .orderBy(asc(websocketExamples.position), asc(websocketExamples.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('Example not found')
      }

      const [current] = rows.splice(currentIndex, 1)
      const targetIndex = Math.max(0, Math.min(input.targetPosition, rows.length))
      rows.splice(targetIndex, 0, current)

      rows.forEach((row, index) => {
        tx.update(websocketExamples).set({ position: index }).where(eq(websocketExamples.id, row.id)).run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function markWebSocketExamplesDeleted(requestId: string, deletedAt: number, db: ReturnType<typeof getDb> = getDb()) {
  db
    .update(websocketExamples)
    .set({ deletedAt })
    .where(and(eq(websocketExamples.requestId, requestId), isNull(websocketExamples.deletedAt)))
    .run()
}

async function getWebSocketExampleRecord(id: string): Promise<WebSocketExampleRecord> {
  const db = getDb()
  const row = db
    .select()
    .from(websocketExamples)
    .where(and(eq(websocketExamples.id, id), isNull(websocketExamples.deletedAt)))
    .get()

  if (!row) {
    throw new Error('Example not found')
  }

  const messages = db
    .select()
    .from(websocketExampleMessages)
    .where(eq(websocketExampleMessages.exampleId, row.id))
    .orderBy(asc(websocketExampleMessages.timestamp), asc(websocketExampleMessages.createdAt))
    .all()
    .map(toWebSocketExampleMessageRecord)

  return {
    id: row.id,
    requestId: row.requestId,
    name: row.name,
    position: row.position,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    messages,
  }
}

function ensureRequestExists(db: ReturnType<typeof getDb>, requestId: string) {
  const request = db.select({ id: requests.id }).from(requests).where(and(eq(requests.id, requestId), isNull(requests.deletedAt))).get()
  if (!request) {
    throw new Error('Request not found')
  }
}

function getNextExamplePosition(db: ReturnType<typeof getDb>, requestId: string) {
  return db
    .select({ id: websocketExamples.id })
    .from(websocketExamples)
    .where(and(eq(websocketExamples.requestId, requestId), isNull(websocketExamples.deletedAt)))
    .all().length
}

function toWebSocketExampleMessageRecord(row: WebSocketExampleMessageRow): WebSocketExampleMessageRecord {
  return {
    id: row.id,
    exampleId: row.exampleId,
    direction: row.direction as WebSocketExampleMessageRecord['direction'],
    body: row.body,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    timestamp: row.timestamp,
    createdAt: row.createdAt,
  }
}
