import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import {
  REQUEST_BATCH_ROW_STATUSES,
  REQUEST_BATCH_SOURCE_TYPES,
  REQUEST_BATCH_STATUSES,
  type CreateRequestBatchInput,
  type DeleteRequestBatchInput,
  type GetRequestBatchInput,
  type GetRequestBatchResponse,
  type ListRequestBatchesInput,
  type ListRequestBatchesResponse,
  type ListRequestBatchRowsInput,
  type ListRequestBatchRowsResponse,
  type RequestBatchRecord,
  type RequestBatchRowRecord,
  type RequestBatchRowStatus,
  type RequestBatchSourceType,
  type RequestBatchStatus,
  type RequestBatchSummary,
  type RequestBatchVariables,
  type UpdateRequestBatchRowInput,
} from '../../common/RequestBatches.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { requestBatchRows, requestBatches, requestHistory } from './schema.js'

type RequestBatchDbRow = typeof requestBatches.$inferSelect
type RequestBatchRowDbRow = typeof requestBatchRows.$inferSelect

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const INSERT_CHUNK_SIZE = 100

const EMPTY_BATCH_SUMMARY: RequestBatchSummary = {
  totalCount: 0,
  pendingCount: 0,
  runningCount: 0,
  completedCount: 0,
  httpErrorCount: 0,
  failedCount: 0,
  cancelledCount: 0,
}

export async function createRequestBatch(input: CreateRequestBatchInput): Promise<GenericResult<RequestBatchRecord>> {
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('Batch name is required')
  }

  try {
    const now = Date.now()
    const batchRow: typeof requestBatches.$inferInsert = {
      id: crypto.randomUUID(),
      requestId: input.requestId,
      requestName: input.requestName,
      name,
      sourceFileName: input.sourceFileName,
      sourceType: input.sourceType,
      sheetName: input.sheetName,
      columnsJson: JSON.stringify(input.columns),
      rowCount: input.rows.length,
      status: 'ready',
      concurrency: null,
      summaryJson: JSON.stringify({
        ...EMPTY_BATCH_SUMMARY,
        totalCount: input.rows.length,
        pendingCount: input.rows.length,
      }),
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    getDb().transaction(transaction => {
      transaction.insert(requestBatches).values(batchRow).run()
      for (let offset = 0; offset < input.rows.length; offset += INSERT_CHUNK_SIZE) {
        transaction
          .insert(requestBatchRows)
          .values(
            input.rows.slice(offset, offset + INSERT_CHUNK_SIZE).map((variables, index) => ({
              id: crypto.randomUUID(),
              batchId: batchRow.id,
              rowIndex: offset + index,
              variablesJson: JSON.stringify(variables),
              status: 'pending',
              historyId: null,
              startedAt: null,
              completedAt: null,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .run()
      }
    })

    return Result.Success(toRequestBatchRecord(batchRow))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function beginRequestBatchExecution(input: {
  batchId: string
  concurrency: number
  requestId: string
}): Promise<GenericResult<{ batch: RequestBatchRecord; rows: RequestBatchRowRecord[] }>> {
  try {
    const db = getDb()
    const batch = db.select().from(requestBatches).where(eq(requestBatches.id, input.batchId)).get()
    if (!batch) {
      return GenericError.Message('Request batch not found')
    }
    if (batch.requestId !== input.requestId) {
      return GenericError.Message('Request batch does not belong to this request')
    }
    const status = parseBatchStatus(batch.status)
    if (status === 'running') {
      return GenericError.Message('Request batch is already running')
    }

    const now = Date.now()
    const existingSummary = toRequestBatchRecord(batch).summary
    const isPristine =
      status === 'ready' &&
      existingSummary.pendingCount === existingSummary.totalCount &&
      existingSummary.runningCount === 0 &&
      existingSummary.completedCount === 0 &&
      existingSummary.httpErrorCount === 0 &&
      existingSummary.failedCount === 0 &&
      existingSummary.cancelledCount === 0
    if (!isPristine) {
      const sourceRows = db
        .select()
        .from(requestBatchRows)
        .where(eq(requestBatchRows.batchId, input.batchId))
        .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
        .all()
      const rerunBatchId = crypto.randomUUID()
      const summary: RequestBatchSummary = {
        ...EMPTY_BATCH_SUMMARY,
        totalCount: sourceRows.length,
        pendingCount: sourceRows.length,
      }
      db.transaction(transaction => {
        transaction
          .insert(requestBatches)
          .values({
            id: rerunBatchId,
            requestId: batch.requestId,
            requestName: batch.requestName,
            name: batch.name,
            sourceFileName: batch.sourceFileName,
            sourceType: batch.sourceType,
            sheetName: batch.sheetName,
            columnsJson: batch.columnsJson,
            rowCount: sourceRows.length,
            status: 'running',
            concurrency: input.concurrency,
            summaryJson: JSON.stringify(summary),
            startedAt: now,
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        for (let offset = 0; offset < sourceRows.length; offset += INSERT_CHUNK_SIZE) {
          transaction
            .insert(requestBatchRows)
            .values(
              sourceRows.slice(offset, offset + INSERT_CHUNK_SIZE).map(row => ({
                id: crypto.randomUUID(),
                batchId: rerunBatchId,
                rowIndex: row.rowIndex,
                variablesJson: row.variablesJson,
                status: 'pending',
                historyId: null,
                startedAt: null,
                completedAt: null,
                createdAt: now,
                updatedAt: now,
              }))
            )
            .run()
        }
      })
      const rerunBatch = db.select().from(requestBatches).where(eq(requestBatches.id, rerunBatchId)).get()
      const rerunRows = db
        .select()
        .from(requestBatchRows)
        .where(eq(requestBatchRows.batchId, rerunBatchId))
        .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
        .all()
      if (!rerunBatch) {
        return GenericError.Message('Request batch rerun could not be created')
      }
      return Result.Success({
        batch: toRequestBatchRecord(rerunBatch),
        rows: rerunRows.map(toRequestBatchRowRecord),
      })
    }

    const updateResult = db
      .update(requestBatches)
      .set({ status: 'running', concurrency: input.concurrency, startedAt: now, completedAt: null, updatedAt: now })
      .where(and(eq(requestBatches.id, input.batchId), eq(requestBatches.status, 'ready')))
      .run()
    if (updateResult.changes === 0) {
      return GenericError.Message('Request batch is not ready')
    }

    const updatedBatch = db.select().from(requestBatches).where(eq(requestBatches.id, input.batchId)).get()
    const rows = db
      .select()
      .from(requestBatchRows)
      .where(eq(requestBatchRows.batchId, input.batchId))
      .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
      .all()
    if (!updatedBatch) {
      return GenericError.Message('Request batch not found')
    }
    return Result.Success({ batch: toRequestBatchRecord(updatedBatch), rows: rows.map(toRequestBatchRowRecord) })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function beginRequestBatchRowExecution(input: {
  batchId: string
  rowId: string
  requestId: string
}): Promise<GenericResult<{ batch: RequestBatchRecord; row: RequestBatchRowRecord }>> {
  try {
    const db = getDb()
    const batch = db.select().from(requestBatches).where(eq(requestBatches.id, input.batchId)).get()
    if (!batch) return GenericError.Message('Request batch not found')
    if (batch.requestId !== input.requestId) {
      return GenericError.Message('Request batch does not belong to this request')
    }
    if (parseBatchStatus(batch.status) === 'running') {
      return GenericError.Message('Request batch is already running')
    }
    const row = db
      .select()
      .from(requestBatchRows)
      .where(and(eq(requestBatchRows.id, input.rowId), eq(requestBatchRows.batchId, input.batchId)))
      .get()
    if (!row) return GenericError.Message('Request batch row not found')

    const now = Date.now()
    const summary = toRequestBatchRecord(batch).summary
    const previousCountKey = SUMMARY_COUNT_KEY_BY_ROW_STATUS[parseRowStatus(row.status)]
    summary[previousCountKey] = Math.max(0, summary[previousCountKey] - 1)
    summary.pendingCount += 1
    const updated = db.transaction(transaction => {
      const updatedBatch = transaction
        .update(requestBatches)
        .set({
          status: 'running',
          concurrency: 1,
          summaryJson: JSON.stringify(summary),
          startedAt: now,
          completedAt: null,
          updatedAt: now,
        })
        .where(and(eq(requestBatches.id, input.batchId), eq(requestBatches.status, batch.status)))
        .returning()
        .get()
      if (!updatedBatch) return null
      const updatedRow = transaction
        .update(requestBatchRows)
        .set({ status: 'pending', historyId: null, startedAt: null, completedAt: null, updatedAt: now })
        .where(and(eq(requestBatchRows.id, input.rowId), eq(requestBatchRows.batchId, input.batchId)))
        .returning()
        .get()
      return updatedRow ? { batch: updatedBatch, row: updatedRow } : null
    })
    return updated
      ? Result.Success({ batch: toRequestBatchRecord(updated.batch), row: toRequestBatchRowRecord(updated.row) })
      : GenericError.Message('Request batch is already running')
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateRequestBatchExecutionRow(
  input: UpdateRequestBatchRowInput
): Promise<GenericResult<{ batch: RequestBatchRecord; row: RequestBatchRowRecord }>> {
  try {
    const db = getDb()
    const existingRow = db.select().from(requestBatchRows).where(eq(requestBatchRows.id, input.id)).get()
    if (!existingRow) {
      return GenericError.Message('Request batch row not found')
    }
    const existingBatch = db.select().from(requestBatches).where(eq(requestBatches.id, existingRow.batchId)).get()
    if (!existingBatch) {
      return GenericError.Message('Request batch not found')
    }

    const summary = toRequestBatchRecord(existingBatch).summary
    const existingStatus = parseRowStatus(existingRow.status)
    if (existingStatus !== input.status) {
      const existingCountKey = SUMMARY_COUNT_KEY_BY_ROW_STATUS[existingStatus]
      const nextCountKey = SUMMARY_COUNT_KEY_BY_ROW_STATUS[input.status]
      summary[existingCountKey] = Math.max(0, summary[existingCountKey] - 1)
      summary[nextCountKey] += 1
    }

    const now = Date.now()
    const patch: Partial<typeof requestBatchRows.$inferInsert> = {
      status: input.status,
      historyId: input.historyId,
      updatedAt: now,
    }
    if (input.startedAt !== undefined) {
      patch.startedAt = input.startedAt
    }
    if (input.completedAt !== undefined) {
      patch.completedAt = input.completedAt
    }
    const updated = db.transaction(transaction => {
      const row = transaction
        .update(requestBatchRows)
        .set(patch)
        .where(eq(requestBatchRows.id, input.id))
        .returning()
        .get()
      const batch = transaction
        .update(requestBatches)
        .set({ summaryJson: JSON.stringify(summary), updatedAt: now })
        .where(eq(requestBatches.id, existingRow.batchId))
        .returning()
        .get()
      return { row, batch }
    })
    if (!updated.row || !updated.batch) {
      return GenericError.Message('Request batch execution state could not be updated')
    }
    return Result.Success({ batch: toRequestBatchRecord(updated.batch), row: toRequestBatchRowRecord(updated.row) })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function cancelPendingRequestBatchRows(
  batchId: string,
  rowIds: string[]
): Promise<GenericResult<RequestBatchRecord>> {
  try {
    const now = Date.now()
    getDb()
      .update(requestBatchRows)
      .set({ status: 'cancelled', completedAt: now, updatedAt: now })
      .where(
        and(
          eq(requestBatchRows.batchId, batchId),
          eq(requestBatchRows.status, 'pending'),
          inArray(requestBatchRows.id, rowIds)
        )
      )
      .run()
    const batch = refreshRequestBatchSummary(batchId)
    return batch ? Result.Success(batch) : GenericError.Message('Request batch not found')
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function finishRequestBatchExecution(input: {
  batchId: string
}): Promise<GenericResult<RequestBatchRecord>> {
  try {
    const db = getDb()
    const now = Date.now()
    const summary = calculateRequestBatchSummary(input.batchId)
    if (summary.runningCount > 0) {
      return GenericError.Message('Request batch still has running rows')
    }
    const status: RequestBatchStatus =
      summary.failedCount > 0 || summary.httpErrorCount > 0
        ? 'failed'
        : summary.cancelledCount > 0
          ? 'cancelled'
          : summary.pendingCount > 0
            ? 'ready'
            : 'completed'
    const batch = db
      .update(requestBatches)
      .set({ status, summaryJson: JSON.stringify(summary), completedAt: now, updatedAt: now })
      .where(and(eq(requestBatches.id, input.batchId), eq(requestBatches.status, 'running')))
      .returning()
      .get()
    return batch ? Result.Success(toRequestBatchRecord(batch)) : GenericError.Message('Request batch not found')
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function recoverStaleRequestBatchExecutions(): Promise<GenericResult<RequestBatchRecord[]>> {
  try {
    const db = getDb()
    const staleIds = db
      .select({ id: requestBatches.id })
      .from(requestBatches)
      .where(eq(requestBatches.status, 'running'))
      .all()
      .map(row => row.id)
    if (staleIds.length === 0) {
      return Result.Success([])
    }

    const now = Date.now()
    db.update(requestBatchRows)
      .set({ status: 'failed', completedAt: now, updatedAt: now })
      .where(and(inArray(requestBatchRows.batchId, staleIds), eq(requestBatchRows.status, 'running')))
      .run()
    const recovered: RequestBatchRecord[] = []
    for (const batchId of staleIds) {
      const result = await finishRequestBatchExecution({ batchId })
      if (result.success) {
        recovered.push(result.data)
      }
    }
    return Result.Success(recovered)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function listRequestBatches(input: ListRequestBatchesInput): Promise<ListRequestBatchesResponse> {
  const limit = normalizePageSize(input.limit)
  const offset = normalizeOffset(input.offset)
  const whereClause = buildBatchWhereClause(input)
  const db = getDb()
  const rows = db
    .select()
    .from(requestBatches)
    .where(whereClause)
    .orderBy(desc(requestBatches.createdAt), desc(requestBatches.id))
    .limit(limit + 1)
    .offset(offset)
    .all()
  const totalCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(requestBatches)
      .where(whereClause)
      .get()?.count ?? 0

  return {
    items: rows.slice(0, limit).map(toRequestBatchRecord),
    nextOffset: rows.length > limit ? offset + limit : null,
    totalCount,
  }
}

export async function getRequestBatch(input: GetRequestBatchInput): Promise<GenericResult<GetRequestBatchResponse>> {
  const db = getDb()
  const batch = db.select().from(requestBatches).where(eq(requestBatches.id, input.id)).get()
  if (!batch) {
    return GenericError.Message('Request batch not found')
  }

  const limit =
    typeof input.rowLimit === 'number' && Number.isSafeInteger(input.rowLimit) && input.rowLimit > 0
      ? input.rowLimit
      : DEFAULT_PAGE_SIZE
  const offset = normalizeOffset(input.rowOffset)
  const rowWhereClause = and(
    buildRowWhereClause(input.id, input.rowSearchQuery ?? ''),
    input.rowStatus ? eq(requestBatchRows.status, input.rowStatus) : undefined
  )
  const rows = db
    .select()
    .from(requestBatchRows)
    .where(rowWhereClause)
    .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
    .limit(limit + 1)
    .offset(offset)
    .all()
  const totalRowCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(requestBatchRows)
      .where(rowWhereClause)
      .get()?.count ?? 0

  return Result.Success({
    batch: toRequestBatchRecord(batch),
    rows: rows.slice(0, limit).map(toRequestBatchRowRecord),
    nextRowOffset: rows.length > limit ? offset + limit : null,
    totalRowCount,
  })
}

export type RequestBatchExportData = {
  batch: RequestBatchRecord
  rows: {
    row: RequestBatchRowRecord
    history: {
      requestUrl: string
      requestBody: string
      responseStatus: number | null
      responseBody: string
      responseHeaders: string
      durationMs: number | null
      responseError: string | null
      responseBodyOmitted: boolean
    } | null
  }[]
}

export function getRequestBatchExportData(batchId: string): GenericResult<RequestBatchExportData> {
  const db = getDb()
  const batch = db.select().from(requestBatches).where(eq(requestBatches.id, batchId)).get()
  if (!batch) return GenericError.Message('Request batch not found')

  const rows = db
    .select({
      row: requestBatchRows,
      history: {
        requestUrl: requestHistory.url,
        requestBody: requestHistory.requestBody,
        responseStatus: requestHistory.responseStatus,
        responseBody: requestHistory.responseBody,
        responseHeaders: requestHistory.responseHeaders,
        durationMs: requestHistory.responseDurationMs,
        responseError: requestHistory.responseError,
        responseBodyOmitted: requestHistory.responseBodyOmitted,
      },
    })
    .from(requestBatchRows)
    .leftJoin(requestHistory, eq(requestBatchRows.historyId, requestHistory.id))
    .where(eq(requestBatchRows.batchId, batchId))
    .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
    .all()

  return Result.Success({
    batch: toRequestBatchRecord(batch),
    rows: rows.map(({ row, history }) => ({ row: toRequestBatchRowRecord(row), history })),
  })
}

export async function listRequestBatchRows(input: ListRequestBatchRowsInput): Promise<ListRequestBatchRowsResponse> {
  const limit = normalizePageSize(input.limit)
  const offset = normalizeOffset(input.offset)
  const whereClause = buildRowWhereClause(input.batchId, input.searchQuery)
  const db = getDb()
  const rows = db
    .select()
    .from(requestBatchRows)
    .where(whereClause)
    .orderBy(asc(requestBatchRows.rowIndex), asc(requestBatchRows.id))
    .limit(limit + 1)
    .offset(offset)
    .all()
  const totalCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(requestBatchRows)
      .where(whereClause)
      .get()?.count ?? 0

  return {
    items: rows.slice(0, limit).map(toRequestBatchRowRecord),
    nextOffset: rows.length > limit ? offset + limit : null,
    totalCount,
  }
}

export async function updateRequestBatchRow(
  input: UpdateRequestBatchRowInput
): Promise<GenericResult<RequestBatchRowRecord>> {
  const result = await updateRequestBatchExecutionRow(input)
  return result.success ? Result.Success(result.data.row) : result
}

export async function deleteRequestBatch(input: DeleteRequestBatchInput): Promise<GenericResult<void>> {
  try {
    const db = getDb()
    const exists = db
      .select({ id: requestBatches.id, status: requestBatches.status })
      .from(requestBatches)
      .where(eq(requestBatches.id, input.id))
      .get()
    if (!exists) {
      return GenericError.Message('Request batch not found')
    }
    if (parseBatchStatus(exists.status) === 'running') {
      return GenericError.Message('Running request batches cannot be deleted')
    }

    db.transaction(transaction => {
      transaction.delete(requestHistory).where(eq(requestHistory.batchId, input.id)).run()
      transaction.delete(requestBatchRows).where(eq(requestBatchRows.batchId, input.id)).run()
      transaction.delete(requestBatches).where(eq(requestBatches.id, input.id)).run()
    })
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function buildBatchWhereClause(input: ListRequestBatchesInput) {
  const filters: SQL[] = []
  if (input.requestId) {
    filters.push(eq(requestBatches.requestId, input.requestId))
  }

  const searchQuery = input.searchQuery.trim().toLowerCase()
  if (searchQuery) {
    const pattern = `%${escapeLikePattern(searchQuery)}%`
    filters.push(
      or(
        sql`lower(${requestBatches.name}) like ${pattern} escape ${'\\'}`,
        sql`lower(${requestBatches.requestName}) like ${pattern} escape ${'\\'}`,
        sql`lower(${requestBatches.sourceFileName}) like ${pattern} escape ${'\\'}`,
        sql`lower(${requestBatches.sheetName}) like ${pattern} escape ${'\\'}`
      ) as SQL
    )
  }
  return filters.length > 0 ? and(...filters) : undefined
}

function buildRowWhereClause(batchId: string, searchQueryInput: string) {
  const searchQuery = searchQueryInput.trim().toLowerCase()
  if (!searchQuery) {
    return eq(requestBatchRows.batchId, batchId)
  }
  return and(
    eq(requestBatchRows.batchId, batchId),
    or(
      sql`lower(${requestBatchRows.variablesJson}) like ${`%${escapeLikePattern(searchQuery)}%`} escape ${'\\'}`,
      sql`lower(${requestBatchRows.status}) like ${`%${escapeLikePattern(searchQuery)}%`} escape ${'\\'}`
    )
  )
}

function toRequestBatchRecord(row: RequestBatchDbRow | typeof requestBatches.$inferInsert): RequestBatchRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    requestName: row.requestName,
    name: row.name,
    sourceFileName: row.sourceFileName,
    sourceType: parseSourceType(row.sourceType),
    sheetName: row.sheetName ?? null,
    columns: parseJson<string[]>(row.columnsJson ?? '[]', []),
    rowCount: row.rowCount ?? 0,
    status: parseBatchStatus(row.status ?? 'ready'),
    concurrency: row.concurrency ?? null,
    summary: {
      ...EMPTY_BATCH_SUMMARY,
      totalCount: row.rowCount ?? 0,
      pendingCount: row.rowCount ?? 0,
      ...parseJson<Partial<RequestBatchSummary>>(row.summaryJson ?? '{}', {}),
    },
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toRequestBatchRowRecord(row: RequestBatchRowDbRow): RequestBatchRowRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    rowIndex: row.rowIndex,
    variables: parseJson<RequestBatchVariables>(row.variablesJson, {}),
    status: parseRowStatus(row.status),
    historyId: row.historyId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseSourceType(value: string): RequestBatchSourceType {
  return REQUEST_BATCH_SOURCE_TYPES.includes(value as RequestBatchSourceType)
    ? (value as RequestBatchSourceType)
    : 'json'
}

function parseRowStatus(value: string): RequestBatchRowStatus {
  return REQUEST_BATCH_ROW_STATUSES.includes(value as RequestBatchRowStatus)
    ? (value as RequestBatchRowStatus)
    : 'failed'
}

function parseBatchStatus(value: string): RequestBatchStatus {
  return REQUEST_BATCH_STATUSES.includes(value as RequestBatchStatus) ? (value as RequestBatchStatus) : 'failed'
}

const SUMMARY_COUNT_KEY_BY_ROW_STATUS = {
  pending: 'pendingCount',
  running: 'runningCount',
  completed: 'completedCount',
  'http-error': 'httpErrorCount',
  failed: 'failedCount',
  cancelled: 'cancelledCount',
} as const satisfies Record<RequestBatchRowStatus, keyof RequestBatchSummary>

function calculateRequestBatchSummary(batchId: string): RequestBatchSummary {
  const summary = { ...EMPTY_BATCH_SUMMARY }
  const rows = getDb()
    .select({ status: requestBatchRows.status })
    .from(requestBatchRows)
    .where(eq(requestBatchRows.batchId, batchId))
    .all()
  summary.totalCount = rows.length
  for (const row of rows) {
    summary[SUMMARY_COUNT_KEY_BY_ROW_STATUS[parseRowStatus(row.status)]] += 1
  }
  return summary
}

function refreshRequestBatchSummary(batchId: string): RequestBatchRecord | null {
  const db = getDb()
  const batch = db
    .update(requestBatches)
    .set({ summaryJson: JSON.stringify(calculateRequestBatchSummary(batchId)), updatedAt: Date.now() })
    .where(eq(requestBatches.id, batchId))
    .returning()
    .get()
  return batch ? toRequestBatchRecord(batch) : null
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function normalizePageSize(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.trunc(value)))
}

function normalizeOffset(value: number | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.trunc(value))
}

function escapeLikePattern(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
