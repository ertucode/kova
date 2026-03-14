import { desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import type {
  DeleteRequestHistoryEntryInput,
  ListRequestHistoryInput,
  ListRequestHistoryResponse,
  RequestConsoleEntry,
  RequestExecutionRecord,
  RequestScriptError,
  TrimRequestHistoryInput,
} from '../../common/Requests.js'
import { getDb } from './index.js'
import { requestHistory } from './schema.js'

type RequestHistoryRow = typeof requestHistory.$inferSelect

const MAX_HISTORY_PAGE_SIZE = 20
const MAX_KEEP_LAST = 1000
const MAX_RESPONSE_BODY_BYTES = 500 * 1024

export async function listRequestHistory(input: ListRequestHistoryInput): Promise<ListRequestHistoryResponse> {
  const db = getDb()
  const limit = normalizePageSize(input.limit)
  const offset = normalizeOffset(input.offset)
  const searchQuery = input.searchQuery.trim().toLowerCase()
  const searchPattern = `%${escapeLikePattern(searchQuery)}%`

  const rows = await (searchQuery
    ? db
        .select()
        .from(requestHistory)
        .where(
          or(
            like(sql`lower(${requestHistory.requestName})`, searchPattern),
            like(sql`lower(${requestHistory.method})`, searchPattern),
            like(sql`lower(${requestHistory.url})`, searchPattern),
            like(sql`lower(${requestHistory.requestHeaders})`, searchPattern),
            like(sql`lower(${requestHistory.requestBody})`, searchPattern),
            like(sql`lower(${requestHistory.requestVariablesJson})`, searchPattern),
            like(sql`lower(${requestHistory.responseHeaders})`, searchPattern),
            like(sql`lower(${requestHistory.responseBody})`, searchPattern),
            like(sql`lower(${requestHistory.responseError})`, searchPattern),
            like(sql`lower(${requestHistory.scriptErrorsJson})`, searchPattern),
            like(sql`lower(${requestHistory.consoleEntriesJson})`, searchPattern)
          )
        )
        .orderBy(desc(requestHistory.createdAt), desc(requestHistory.id))
        .limit(limit + 1)
        .offset(offset)
    : db
        .select()
        .from(requestHistory)
        .orderBy(desc(requestHistory.createdAt), desc(requestHistory.id))
        .limit(limit + 1)
        .offset(offset))

  const items = rows.slice(0, limit).map(toRequestExecutionRecord)

  return {
    items,
    nextOffset: rows.length > limit ? offset + limit : null,
  }
}

export async function persistRequestHistory(input: { execution: RequestExecutionRecord; keepLast: number }) {
  const db = getDb()
  const execution = omitLargeResponseBody(input.execution)

  db.insert(requestHistory)
    .values({
      id: execution.id,
      requestId: execution.requestId,
      requestName: execution.requestName,
      method: execution.request.method,
      url: execution.request.url,
      requestHeaders: execution.request.headers,
      requestBody: execution.request.body,
      requestVariablesJson: JSON.stringify(execution.request.variables ?? {}),
      requestBodyType: execution.request.bodyType,
      requestRawType: execution.request.rawType,
      responseStatus: execution.response?.status ?? null,
      responseStatusText: execution.response?.statusText ?? null,
      responseHeaders: execution.response?.headers ?? '',
      responseBody: execution.response?.body ?? '',
      responseBodyOmitted: execution.response?.bodyOmitted ?? false,
      responseError: execution.responseError,
      responseDurationMs: execution.response?.durationMs ?? null,
      responseReceivedAt: execution.response?.receivedAt ?? null,
      scriptErrorsJson: JSON.stringify(execution.scriptErrors ?? []),
      consoleEntriesJson: JSON.stringify(execution.consoleEntries ?? []),
      sentAt: execution.request.sentAt,
      createdAt: execution.request.sentAt,
    })
    .run()

  trimRequestHistoryInternal(normalizeKeepLast(input.keepLast))

  return execution
}

export async function deleteRequestHistoryEntry(input: DeleteRequestHistoryEntryInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const result = db.delete(requestHistory).where(eq(requestHistory.id, input.id)).run()
    if (result.changes === 0) {
      return GenericError.Message('History entry not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function trimRequestHistory(input: TrimRequestHistoryInput): Promise<GenericResult<void>> {
  try {
    trimRequestHistoryInternal(normalizeKeepLast(input.keepLast))
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function trimRequestHistoryInternal(keepLast: number) {
  const db = getDb()
  const orderedIds = db
    .select({ id: requestHistory.id })
    .from(requestHistory)
    .orderBy(desc(requestHistory.createdAt), desc(requestHistory.id))
    .all()
    .map(row => row.id)

  const idsToDelete = orderedIds.slice(keepLast)

  if (idsToDelete.length === 0) {
    return
  }

  db.delete(requestHistory).where(inArray(requestHistory.id, idsToDelete)).run()
}

function omitLargeResponseBody(execution: RequestExecutionRecord): RequestExecutionRecord {
  if (!execution.response) {
    return execution
  }

  if (getByteLength(execution.response.body) <= MAX_RESPONSE_BODY_BYTES) {
    return execution
  }

  return {
    ...execution,
    response: {
      ...execution.response,
      body: '',
      bodyOmitted: true,
    },
  }
}

function toRequestExecutionRecord(row: RequestHistoryRow): RequestExecutionRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    requestName: row.requestName,
    request: {
      requestId: row.requestId,
      requestName: row.requestName,
      method: row.method as RequestExecutionRecord['request']['method'],
      url: row.url,
      headers: row.requestHeaders,
      body: row.requestBody,
      variables: parseJson<Record<string, string>>(row.requestVariablesJson, {}),
      bodyType: row.requestBodyType as RequestExecutionRecord['request']['bodyType'],
      rawType: row.requestRawType as RequestExecutionRecord['request']['rawType'],
      sentAt: row.sentAt,
    },
    response:
      row.responseStatus === null || row.responseStatusText === null || row.responseDurationMs === null || row.responseReceivedAt === null
        ? null
        : {
            status: row.responseStatus,
            statusText: row.responseStatusText,
            headers: row.responseHeaders,
            body: row.responseBody,
            bodyOmitted: row.responseBodyOmitted,
            durationMs: row.responseDurationMs,
            receivedAt: row.responseReceivedAt,
          },
    responseError: row.responseError,
    scriptErrors: parseJson<RequestScriptError[]>(row.scriptErrorsJson, []),
    consoleEntries: parseJson<RequestConsoleEntry[]>(row.consoleEntriesJson, []),
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

function normalizeKeepLast(value: number) {
  if (!Number.isFinite(value)) {
    return MAX_KEEP_LAST
  }

  return Math.max(1, Math.min(MAX_KEEP_LAST, Math.trunc(value)))
}

function escapeLikePattern(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).length
}
