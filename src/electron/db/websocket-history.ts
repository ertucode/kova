import { and, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import type {
  DeleteRequestHistoryEntryInput,
  ListRequestHistoryInput,
  WebSocketMessageRecord,
  WebSocketSessionRecord,
} from '../../common/Requests.js'
import { getDb } from './index.js'
import { websocketHistory, websocketHistoryMessages } from './schema.js'

type WebSocketHistoryRow = typeof websocketHistory.$inferSelect
type WebSocketHistoryMessageRow = typeof websocketHistoryMessages.$inferSelect

const MAX_HISTORY_PAGE_SIZE = 20

export async function listWebSocketHistory(input: ListRequestHistoryInput): Promise<{ items: WebSocketSessionRecord[]; nextOffset: number | null }> {
  const db = getDb()
  const limit = normalizePageSize(input.limit)
  const offset = normalizeOffset(input.offset)
  const searchQuery = input.searchQuery.trim().toLowerCase()
  const searchPattern = `%${escapeLikePattern(searchQuery)}%`

  const rows = await (searchQuery
    ? db
        .select()
        .from(websocketHistory)
        .where(
          or(
            like(sql`lower(${websocketHistory.requestName})`, searchPattern),
            like(sql`lower(${websocketHistory.url})`, searchPattern),
            like(sql`lower(${websocketHistory.requestHeaders})`, searchPattern),
            like(sql`lower(${websocketHistory.responseError})`, searchPattern),
            like(sql`lower(${websocketHistory.closeReason})`, searchPattern)
          )
        )
        .orderBy(desc(websocketHistory.createdAt), desc(websocketHistory.id))
        .limit(limit + 1)
        .offset(offset)
    : db
        .select()
        .from(websocketHistory)
        .orderBy(desc(websocketHistory.createdAt), desc(websocketHistory.id))
        .limit(limit + 1)
        .offset(offset))

  const items = await Promise.all(rows.slice(0, limit).map(toWebSocketSessionRecord))
  return { items, nextOffset: rows.length > limit ? offset + limit : null }
}

export async function createWebSocketHistory(input: Omit<WebSocketSessionRecord, 'messages' | 'itemType'>) {
  const now = Date.now()
  const row: WebSocketHistoryRow = {
    id: input.id,
    requestId: input.requestId,
    requestName: input.requestName,
    url: input.url,
    requestHeaders: input.requestHeaders,
    requestVariablesJson: JSON.stringify(input.requestVariables ?? {}),
    historySizeBytes: 0,
    connectedAt: input.connectedAt,
    disconnectedAt: input.disconnectedAt,
    closeCode: input.closeCode,
    closeReason: input.closeReason,
    responseError: input.responseError,
    createdAt: input.connectedAt || now,
  }
  getDb().insert(websocketHistory).values(row).run()
}

export async function appendWebSocketHistoryMessage(input: { historyId: string; message: WebSocketMessageRecord }) {
  const db = getDb()
  const row: WebSocketHistoryMessageRow = {
    id: input.message.id,
    historyId: input.historyId,
    direction: input.message.direction,
    body: input.message.body,
    mimeType: input.message.mimeType,
    sizeBytes: input.message.sizeBytes,
    timestamp: input.message.timestamp,
    createdAt: input.message.timestamp,
  }

  db.insert(websocketHistoryMessages).values(row).run()
  db
    .update(websocketHistory)
    .set({ historySizeBytes: sql`${websocketHistory.historySizeBytes} + ${input.message.sizeBytes}` })
    .where(eq(websocketHistory.id, input.historyId))
    .run()
}

export async function finalizeWebSocketHistory(input: {
  historyId: string
  disconnectedAt: number
  closeCode: number | null
  closeReason: string | null
  responseError: string | null
}) {
  getDb()
    .update(websocketHistory)
    .set({
      disconnectedAt: input.disconnectedAt,
      closeCode: input.closeCode,
      closeReason: input.closeReason,
      responseError: input.responseError,
    })
    .where(eq(websocketHistory.id, input.historyId))
    .run()
}

export async function deleteWebSocketHistoryEntry(input: DeleteRequestHistoryEntryInput): Promise<GenericResult<void>> {
  try {
    const db = getDb()
    db.delete(websocketHistoryMessages).where(eq(websocketHistoryMessages.historyId, input.id)).run()
    const result = db.delete(websocketHistory).where(eq(websocketHistory.id, input.id)).run()
    if (result.changes === 0) {
      return GenericError.Message('History entry not found')
    }
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

async function toWebSocketSessionRecord(row: WebSocketHistoryRow): Promise<WebSocketSessionRecord> {
  const messages = getDb()
    .select()
    .from(websocketHistoryMessages)
    .where(eq(websocketHistoryMessages.historyId, row.id))
    .orderBy(websocketHistoryMessages.timestamp, websocketHistoryMessages.id)
    .all()
    .map(toWebSocketMessageRecord)

  return {
    itemType: 'websocket',
    id: row.id,
    requestId: row.requestId,
    requestName: row.requestName,
    url: row.url,
    requestHeaders: row.requestHeaders,
    requestVariables: parseJson<Record<string, string>>(row.requestVariablesJson, {}),
    connectionState: 'closed',
    connectedAt: row.connectedAt,
    disconnectedAt: row.disconnectedAt,
    closeCode: row.closeCode,
    closeReason: row.closeReason,
    responseError: row.responseError,
    historySizeBytes: row.historySizeBytes,
    messages,
  }
}

function toWebSocketMessageRecord(row: WebSocketHistoryMessageRow): WebSocketMessageRecord {
  return {
    id: row.id,
    direction: row.direction as WebSocketMessageRecord['direction'],
    body: row.body,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    timestamp: row.timestamp,
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizePageSize(limit: number) {
  if (!Number.isFinite(limit)) {
    return MAX_HISTORY_PAGE_SIZE
  }

  return Math.max(1, Math.min(MAX_HISTORY_PAGE_SIZE, Math.trunc(limit)))
}

function normalizeOffset(offset: number) {
  if (!Number.isFinite(offset)) {
    return 0
  }

  return Math.max(0, Math.trunc(offset))
}

function escapeLikePattern(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
