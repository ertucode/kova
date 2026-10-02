import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import {
  FOLDER_RUN_ITERATION_STATUSES,
  FOLDER_RUN_STATUSES,
  createEmptyFolderRunCampaignSummary,
  createEmptyFolderRunSummary,
  type DeleteFolderRunHistoryInput,
  type FolderRunCampaignSummary,
  type FolderRunHistoryRecord,
  type FolderRunIterationRecord,
  type FolderRunIterationStatus,
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
import { Typescript } from '../../common/Typescript.js'
import { getDb } from './index.js'
import { folderRunHistory, folderRunIterations, requestHistory } from './schema.js'
import { parseFolderRequestRunConfig, serializeFolderRequestRunConfig } from './folders.js'

type FolderRunHistoryRow = typeof folderRunHistory.$inferSelect
type FolderRunIterationRow = typeof folderRunIterations.$inferSelect
type RequestHistoryRow = typeof requestHistory.$inferSelect

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const RETAINED_EDGE_ITERATION_COUNT = 20

export function createFolderRunHistory(run: FolderRunRecord) {
  getDb().insert(folderRunHistory).values(toHistoryValues(run)).run()
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

export function createFolderRunIteration(run: FolderRunRecord, iteration: FolderRunIterationRecord) {
  getDb().transaction(transaction => {
    transaction.insert(folderRunIterations).values(toIterationValues(iteration)).run()
    transaction
      .update(folderRunHistory)
      .set({ summaryJson: JSON.stringify(run.summary) })
      .where(eq(folderRunHistory.id, run.id))
      .run()
  })
}

export function completeFolderRunIteration(run: FolderRunRecord, iteration: FolderRunIterationRecord) {
  const db = getDb()
  db.transaction(transaction => {
    transaction
      .update(folderRunIterations)
      .set(toIterationValues(iteration))
      .where(eq(folderRunIterations.id, iteration.id))
      .run()
    transaction
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

    const completedRows = transaction
      .select({ id: folderRunIterations.id, iterationIndex: folderRunIterations.iterationIndex })
      .from(folderRunIterations)
      .where(
        and(
          eq(folderRunIterations.runId, run.id),
          inArray(folderRunIterations.status, ['passed', 'failed', 'cancelled'])
        )
      )
      .orderBy(asc(folderRunIterations.iterationIndex))
      .all()
    const prunedIds = completedRows
      .slice(RETAINED_EDGE_ITERATION_COUNT, -RETAINED_EDGE_ITERATION_COUNT)
      .map(row => row.id)
    if (prunedIds.length === 0) return
    transaction.delete(requestHistory).where(inArray(requestHistory.folderRunIterationId, prunedIds)).run()
    transaction.delete(folderRunIterations).where(inArray(folderRunIterations.id, prunedIds)).run()
  })
}

export async function listFolderRunHistory(input: ListFolderRunHistoryInput): Promise<ListFolderRunHistoryResponse> {
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
  const totalCount =
    db
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
  const runRow = db.select().from(folderRunHistory).where(eq(folderRunHistory.id, input.id)).get()
  if (!runRow) return GenericError.Message('Folder run history not found')

  const iterationRows = db
    .select()
    .from(folderRunIterations)
    .where(eq(folderRunIterations.runId, input.id))
    .orderBy(asc(folderRunIterations.iterationIndex))
    .all()
  const executionRows = db
    .select()
    .from(requestHistory)
    .where(eq(requestHistory.folderRunId, input.id))
    .orderBy(asc(requestHistory.sentAt), asc(requestHistory.id))
    .all()
  const executionsByIterationId = new Map<string, RequestExecutionRecord[]>()
  for (const row of executionRows) {
    if (!row.folderRunIterationId) continue
    const executions = executionsByIterationId.get(row.folderRunIterationId) ?? []
    executions.push(toRequestExecutionRecord(row))
    executionsByIterationId.set(row.folderRunIterationId, executions)
  }

  let iterations = iterationRows.map(row => toFolderRunIterationRecord(row, executionsByIterationId.get(row.id) ?? []))
  if (iterations.length === 0 && executionRows.length > 0) {
    iterations = [toLegacyIteration(runRow, executionRows.map(toRequestExecutionRecord))]
  }
  return Result.Success({ run: toFolderRunHistoryRecord(runRow), iterations })
}

export async function deleteFolderRunHistory(input: DeleteFolderRunHistoryInput): Promise<GenericResult<void>> {
  const db = getDb()
  try {
    const deleted = db.transaction(transaction => {
      transaction.delete(requestHistory).where(eq(requestHistory.folderRunId, input.runId)).run()
      transaction.delete(folderRunIterations).where(eq(folderRunIterations.runId, input.runId)).run()
      return transaction.delete(folderRunHistory).where(eq(folderRunHistory.id, input.runId)).run()
    })
    return deleted.changes === 0 ? GenericError.Message('Folder run history not found') : Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function recoverStaleFolderRuns() {
  const db = getDb()
  const staleRows = db.select().from(folderRunHistory).where(eq(folderRunHistory.status, 'running')).all()
  if (staleRows.length === 0) return
  const now = Date.now()
  db.transaction(transaction => {
    for (const row of staleRows) {
      const summary = parseCampaignSummary(row.summaryJson, row.requestCount, row.status)
      const runningIterations = transaction
        .select()
        .from(folderRunIterations)
        .where(and(eq(folderRunIterations.runId, row.id), eq(folderRunIterations.status, 'running')))
        .all()
      for (const iteration of runningIterations) {
        const executionsByRequestId = new Map(
          transaction
            .select()
            .from(requestHistory)
            .where(eq(requestHistory.folderRunIterationId, iteration.id))
            .all()
            .map(toRequestExecutionRecord)
            .map(execution => [execution.requestId, execution])
        )
        const requests = parseJson<FolderRunIterationRecord['requests']>(iteration.requestsJson, []).map(request => {
          const execution = executionsByRequestId.get(request.requestId) ?? null
          if (!execution) {
            return { ...request, status: 'cancelled' as const, completedAt: now }
          }
          return {
            ...request,
            status: getRecoveredRequestStatus(execution),
            execution,
            error: execution.responseError,
            startedAt: execution.request.sentAt,
            completedAt: execution.response?.receivedAt ?? now,
          }
        })
        const iterationSummary = buildRecoveredIterationSummary(requests, iteration.startedAt, now)
        summary.requestCount += iterationSummary.requestCount
        summary.passedRequestCount += iterationSummary.passedRequestCount
        summary.failedRequestCount += iterationSummary.failedRequestCount
        summary.cancelledRequestCount += iterationSummary.cancelledRequestCount
        summary.skippedRequestCount += iterationSummary.skippedRequestCount
        summary.totalTestCount += iterationSummary.totalTestCount
        summary.passedTestCount += iterationSummary.passedTestCount
        summary.failedTestCount += iterationSummary.failedTestCount
        summary.skippedTestCount += iterationSummary.skippedTestCount
        transaction
          .update(folderRunIterations)
          .set({
            status: 'cancelled',
            summaryJson: JSON.stringify(iterationSummary),
            requestsJson: JSON.stringify(requests.map(request => ({ ...request, execution: null }))),
            completedAt: now,
          })
          .where(eq(folderRunIterations.id, iteration.id))
          .run()
      }
      summary.cancelledIterationCount += runningIterations.length
      summary.completedIterationCount += runningIterations.length
      summary.runningIterationCount = 0
      summary.durationMs = now - row.startedAt
      transaction
        .update(folderRunHistory)
        .set({
          status: 'cancelled',
          summaryJson: JSON.stringify(summary),
          requestCount: summary.requestCount,
          passedRequestCount: summary.passedRequestCount,
          failedRequestCount: summary.failedRequestCount,
          completedAt: now,
        })
        .where(eq(folderRunHistory.id, row.id))
        .run()

      const completedRows = transaction
        .select({ id: folderRunIterations.id })
        .from(folderRunIterations)
        .where(eq(folderRunIterations.runId, row.id))
        .orderBy(asc(folderRunIterations.iterationIndex))
        .all()
      const prunedIds = completedRows
        .slice(RETAINED_EDGE_ITERATION_COUNT, -RETAINED_EDGE_ITERATION_COUNT)
        .map(iteration => iteration.id)
      if (prunedIds.length > 0) {
        transaction.delete(requestHistory).where(inArray(requestHistory.folderRunIterationId, prunedIds)).run()
        transaction.delete(folderRunIterations).where(inArray(folderRunIterations.id, prunedIds)).run()
      }
    }
  })
}

function buildRecoveredIterationSummary(
  requests: FolderRunIterationRecord['requests'],
  startedAt: number,
  completedAt: number
): FolderRunSummary {
  const summary = createEmptyFolderRunSummary(requests.length)
  summary.pendingRequestCount = 0
  for (const request of requests) {
    switch (request.status) {
      case 'pending':
        summary.pendingRequestCount += 1
        break
      case 'running':
        summary.runningRequestCount += 1
        break
      case 'passed':
        summary.passedRequestCount += 1
        break
      case 'failed':
        summary.failedRequestCount += 1
        break
      case 'cancelled':
        summary.cancelledRequestCount += 1
        break
      case 'skipped':
        summary.skippedRequestCount += 1
        break
      default:
        Typescript.assertUnreachable(request.status)
    }
    const testRun = request.execution?.testRun
    if (testRun) {
      summary.totalTestCount += testRun.totalCount
      summary.passedTestCount += testRun.passedCount
      summary.failedTestCount += testRun.failedCount
      summary.skippedTestCount += testRun.skippedCount
    }
  }
  summary.durationMs = completedAt - startedAt
  return summary
}

function getRecoveredRequestStatus(execution: RequestExecutionRecord): 'passed' | 'failed' {
  return execution.responseError || execution.scriptErrors.length > 0 || (execution.testRun?.failedCount ?? 0) > 0
    ? 'failed'
    : 'passed'
}

function toHistoryValues(run: FolderRunRecord): typeof folderRunHistory.$inferInsert {
  return {
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
  }
}

function toIterationValues(iteration: FolderRunIterationRecord): typeof folderRunIterations.$inferInsert {
  return {
    id: iteration.id,
    runId: iteration.runId,
    iterationIndex: iteration.index,
    status: iteration.status,
    summaryJson: JSON.stringify(iteration.summary),
    requestsJson: JSON.stringify(iteration.requests.map(request => ({ ...request, execution: null }))),
    startedAt: iteration.startedAt,
    completedAt: iteration.completedAt,
  }
}

function toFolderRunHistoryRecord(row: FolderRunHistoryRow): FolderRunHistoryRecord {
  return {
    id: row.id,
    folderId: row.folderId,
    folderName: row.folderName,
    config: parseFolderRequestRunConfig(row.runConfigJson),
    status: FOLDER_RUN_STATUSES.includes(row.status as FolderRunStatus) ? (row.status as FolderRunStatus) : 'failed',
    summary: parseCampaignSummary(row.summaryJson, row.requestCount, row.status),
    requestCount: row.requestCount,
    passedRequestCount: row.passedRequestCount,
    failedRequestCount: row.failedRequestCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

function toFolderRunIterationRecord(
  row: FolderRunIterationRow,
  executions: RequestExecutionRecord[]
): FolderRunIterationRecord {
  const requests = parseJson<FolderRunIterationRecord['requests']>(row.requestsJson, [])
  const executionsByRequestId = new Map(executions.map(execution => [execution.requestId, execution]))
  return {
    id: row.id,
    runId: row.runId,
    index: row.iterationIndex,
    status: FOLDER_RUN_ITERATION_STATUSES.includes(row.status as FolderRunIterationStatus)
      ? (row.status as FolderRunIterationStatus)
      : 'failed',
    summary: parseJson(row.summaryJson, createEmptyFolderRunSummary(requests.length)),
    requests: requests.map(request => ({
      ...request,
      execution: executionsByRequestId.get(request.requestId) ?? null,
    })),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

function toLegacyIteration(row: FolderRunHistoryRow, executions: RequestExecutionRecord[]): FolderRunIterationRecord {
  return {
    id: row.id,
    runId: row.id,
    index: 0,
    status: row.status === 'cancelled' ? 'cancelled' : row.failedRequestCount > 0 ? 'failed' : 'passed',
    summary: parseJson(row.summaryJson, createEmptyFolderRunSummary(row.requestCount)),
    requests: executions.map((execution, index) => ({
      requestId: execution.requestId,
      requestName: execution.requestName,
      method: execution.request.method,
      url: execution.request.url,
      position: index,
      hasTests: execution.testRun !== null,
      status:
        execution.responseError || execution.scriptErrors.length > 0 || (execution.testRun?.failedCount ?? 0) > 0
          ? 'failed'
          : 'passed',
      execution,
      error: execution.responseError,
      startedAt: execution.request.sentAt,
      completedAt: execution.response?.receivedAt ?? null,
    })),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  }
}

function parseCampaignSummary(value: string, requestCount: number, status: string): FolderRunCampaignSummary {
  const parsed = parseJson<Partial<FolderRunCampaignSummary>>(value, {})
  const defaults = createEmptyFolderRunCampaignSummary(1)
  const completedIterationCount = parsed.completedIterationCount ?? (status === 'running' ? 0 : 1)
  return {
    ...defaults,
    ...parsed,
    requestCount: parsed.requestCount ?? requestCount,
    targetIterationCount: parsed.targetIterationCount ?? 1,
    completedIterationCount,
    passedIterationCount:
      parsed.passedIterationCount ?? (completedIterationCount > 0 && (parsed.failedRequestCount ?? 0) === 0 ? 1 : 0),
    failedIterationCount:
      parsed.failedIterationCount ?? (completedIterationCount > 0 && (parsed.failedRequestCount ?? 0) > 0 ? 1 : 0),
  }
}

function toRequestExecutionRecord(row: RequestHistoryRow): RequestExecutionRecord {
  return {
    itemType: 'http',
    id: row.id,
    folderRunId: row.folderRunId,
    folderRunFolderId: row.folderRunFolderId,
    folderRunIterationId: row.folderRunIterationId,
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
      row.responseStatus === null ||
      row.responseStatusText === null ||
      row.responseDurationMs === null ||
      row.responseReceivedAt === null
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
  return Number.isFinite(limit) ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(limit))) : DEFAULT_PAGE_SIZE
}

function normalizeOffset(offset: number) {
  return Number.isFinite(offset) ? Math.max(0, Math.trunc(offset)) : 0
}
