import { and, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import type {
  CreateWebSocketSavedMessageInput,
  DeleteWebSocketSavedMessageInput,
  ListWebSocketSavedMessagesInput,
  UpdateWebSocketSavedMessageInput,
  WebSocketSavedMessageRecord,
} from '../../common/Requests.js'
import { getDb } from './index.js'
import { websocketSavedMessages } from './schema.js'

type WebSocketSavedMessageRow = typeof websocketSavedMessages.$inferSelect

export async function listWebSocketSavedMessages(input: ListWebSocketSavedMessagesInput): Promise<WebSocketSavedMessageRecord[]> {
  return getDb()
    .select()
    .from(websocketSavedMessages)
    .where(and(eq(websocketSavedMessages.requestId, input.requestId), isNull(websocketSavedMessages.deletedAt)))
    .orderBy(websocketSavedMessages.createdAt, websocketSavedMessages.id)
    .all()
    .map(toRecord)
}

export async function createWebSocketSavedMessage(
  input: CreateWebSocketSavedMessageInput
): Promise<GenericResult<WebSocketSavedMessageRecord>> {
  const body = input.body.trim()
  if (!body) {
    return GenericError.Message('Message body is required')
  }

  try {
    const now = Date.now()
    const row: WebSocketSavedMessageRow = {
      id: crypto.randomUUID(),
      requestId: input.requestId,
      body,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    getDb().insert(websocketSavedMessages).values(row).run()
    return Result.Success(toRecord(row))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateWebSocketSavedMessage(
  input: UpdateWebSocketSavedMessageInput
): Promise<GenericResult<WebSocketSavedMessageRecord>> {
  const body = input.body.trim()
  if (!body) {
    return GenericError.Message('Message body is required')
  }

  try {
    const now = Date.now()
    const result = getDb()
      .update(websocketSavedMessages)
      .set({ body, updatedAt: now })
      .where(and(eq(websocketSavedMessages.id, input.id), isNull(websocketSavedMessages.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Saved message not found')
    }

    const row = getDb()
      .select()
      .from(websocketSavedMessages)
      .where(and(eq(websocketSavedMessages.id, input.id), isNull(websocketSavedMessages.deletedAt)))
      .get()

    if (!row) {
      return GenericError.Message('Saved message not found')
    }

    return Result.Success(toRecord(row))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteWebSocketSavedMessage(input: DeleteWebSocketSavedMessageInput): Promise<GenericResult<void>> {
  try {
    const result = getDb()
      .update(websocketSavedMessages)
      .set({ deletedAt: Date.now() })
      .where(and(eq(websocketSavedMessages.id, input.id), isNull(websocketSavedMessages.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Saved message not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toRecord(row: WebSocketSavedMessageRow): WebSocketSavedMessageRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}
