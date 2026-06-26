import { desc, eq, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import {
  FOLDER_RUN_STATUSES,
  createEmptyFolderRunSummary,
  type FolderRunHistoryRecord,
  type FolderRunRecord,
  type FolderRunStatus,
  type FolderRunSummary,
  type GetFolderRunHistoryInput,
  type GetFolderRunHistoryResponse,
  type ListFolderRunHistoryInput,
  type ListFolderRunHistoryResponse,
} from '../../common/FolderRuns.js'
import type { RequestExecutionRecord } from '../../common/Requests.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { folderRunHistory, requestHistory } from './schema.js'
import { parseFolderRequestRunConfig, serializeFolderRequestRunConfig } from './folders.js'

type FolderRunHistoryRow = typeof folderRunHistory.$inferSelect
type RequestHistoryRow = typeof requestHistory.$inferSelect

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export function createFolderRunHistory(run: FolderRunRecord) {
  getDb()
    .insert(folderRunHistory)
    .values({
      id: run.id,
      folderId: run.folderId,
      folderName: run.folderName,
      runConfigJson: serializeFolderRequestRunConfig(run.config),
      status: run.status,
      summaryJson: JSON.stringify(run.summary),
      requestCount: run.summary.requestCount,
      passedRequestCount: run.summary.passedRequestCount,
      failedRequestCount: run.summary.failedRequestCount,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      createdAt: run.startedAt,
    })
    .run()
}

export function updateFolderRunHistory(run: FolderRunRecord) {
  getDb()
    .update(folderRunHistory)
    .set({
      status: run.status,
      summaryJson: JSON.stringify(run.summary),
      requestCount: run.summary.requestCount,
      passedRequestCount: run.summary.passedRequestCount,
      failedRequestCount: run.summary.failedRequestCount,
      completedAt: run.completedAt,
    })
    .where(eq(folderRunHistory.id, run.id))
    .run()
}

export async function listFolderRunHistory(
  input: ListFolderRunHistoryInput
): Promise<ListFolderRunHistoryResponse> {
  const limit = normalizePageSize(input.limit)
  const offset = normalizeOffset(input.offset)
  const db = getDb()
  const whereClause = eq(folderRunHistory.folderId, input.folderId)
  const rows = db
    .select()
    .from(folderRunHistory)
    .where(whereClause)
    .orderBy(desc(folderRunHistory.startedAt), desc(folderRunHistory.id))
    .limit(limit + 1)
    .offset(offset)
    .all()
  const totalCount = db
    .select({ count: sql<number>`count(*)` })
    .from(folderRunHistory)
    .where(whereClause)
    .get()?.count ?? 0

  return {
    items: rows.slice(0, limit).map(toFolderRunHistoryRecord),
    nextOffset: rows.length > limit ? offset + limit : null,
    totalCount,
  }
}

export async function getFolderRunHistory(
  input: GetFolderRunHistoryInput
): Promise<GenericResult<GetFolderRunHistoryResponse>> {
  const db = getDb()
  const run = db.select().from(folderRunHistory).where(eq(folderRunHistory.id, input.id)).get()
  if (!run) {
    return GenericError.Message('Folder run history not found')
  }

  const requests = db
    .select()
    .from(requestHistory)
    .where(eq(requestHistory.folderRunId, input.id))
    .orderBy(requestHistory.sentAt, requestHistory.id)
    .all()
    .map(toRequestExecutionRecord)

  return Result.Success({ run: toFolderRunHistoryRecord(run), requests })
}

function toFolderRunHistoryRecord(row: FolderRunHistoryRow): FolderRunHistoryRecord {
  return {
    id: row.id,
    folderId: row.folderId,
    folderName: row.folderName,
    config: parseFolderRequestRunConfig(row.runConfigJson),
    status: FOLDER_RUN_STATUSES.includes(row.status as FolderRunStatus) ? (row.status as FolderRunStatus) : 'failed',
    summary: parseJson<FolderRunSummary>(row.summaryJson, createEmptyFolderRunSummary(row.requestCount)),
    requestCount: row.requestCount,
    passedRequestCount: row.passedRequestCount,
    failedRequestCount: row.failedRequestCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

function toRequestExecutionRecord(row: RequestHistoryRow): RequestExecutionRecord {
  return {
    itemType: 'http',
    id: row.id,
    folderRunId: row.folderRunId,
    folderRunFolderId: row.folderRunFolderId,
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
      graphqlQuery: row.graphqlQuery,
      graphqlVariables: row.graphqlVariables,
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
    scriptErrors: parseJson<RequestExecutionRecord['scriptErrors']>(row.scriptErrorsJson, []),
    testRun: parseJson<RequestExecutionRecord['testRun']>(row.testRunJson, null),
    consoleEntries: parseJson<RequestExecutionRecord['consoleEntries']>(row.consoleEntriesJson, []),
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
    return DEFAULT_PAGE_SIZE
  }

  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit)))
}

function normalizeOffset(offset: number) {
  if (!Number.isFinite(offset)) {
    return 0
  }

  return Math.max(0, Math.trunc(offset))
}
