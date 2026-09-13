import { GenericError, type GenericResult } from '../common/GenericError.js'
import type {
  ActiveRequestBatchState,
  CancelRequestBatchInput,
  RequestBatchRecord,
  RequestBatchRowRecord,
  RunRequestBatchRowInput,
  RunRequestBatchRowResponse,
  StartRequestBatchInput,
  StartRequestBatchResponse,
} from '../common/RequestBatches.js'
import type { SendRequestInput } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import {
  beginRequestBatchExecution,
  beginRequestBatchRowExecution,
  cancelPendingRequestBatchRows,
  finishRequestBatchExecution,
  recoverStaleRequestBatchExecutions,
  updateRequestBatchExecutionRow,
} from './db/request-batches.js'
import { emitGenericEvent } from './generic-events.js'
import { cancelHttpRequest, sendRequest } from './send-request.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { listVisibleEnvironments } from './db/environments.js'

type SendRequestOptions = Parameters<typeof sendRequest>[1]

type ActiveBatch = {
  batchId: string
  sourceBatchId: string
  request: SendRequestInput
  rows: RequestBatchRowRecord[]
  concurrency: number
  activeExecutions: Map<string, string>
  isCancelling: boolean
  completion: Promise<void> | null
}

export type RequestBatchRunnerDependencies = {
  begin: typeof beginRequestBatchExecution
  beginRow: typeof beginRequestBatchRowExecution
  updateRow: typeof updateRequestBatchExecutionRow
  cancelPendingRows: typeof cancelPendingRequestBatchRows
  finish: typeof finishRequestBatchExecution
  recoverStale: typeof recoverStaleRequestBatchExecutions
  send: typeof sendRequest
  cancel: typeof cancelHttpRequest
  emit: typeof emitGenericEvent
  createExecutionId: () => string
  loadEnvironmentSnapshot?: (request: SendRequestInput) => Promise<SendRequestInput['environmentSnapshot']>
}

const defaultDependencies: RequestBatchRunnerDependencies = {
  begin: beginRequestBatchExecution,
  beginRow: beginRequestBatchRowExecution,
  updateRow: updateRequestBatchExecutionRow,
  cancelPendingRows: cancelPendingRequestBatchRows,
  finish: finishRequestBatchExecution,
  recoverStale: recoverStaleRequestBatchExecutions,
  send: sendRequest,
  cancel: cancelHttpRequest,
  emit: emitGenericEvent,
  createExecutionId: () => crypto.randomUUID(),
  loadEnvironmentSnapshot: async request => {
    const folderId = await getRequestParentFolderId(request.requestId)
    return listVisibleEnvironments({ folderId, activeEnvironmentIds: request.activeEnvironmentIds })
  },
}

export function createRequestBatchRunner(dependencies: RequestBatchRunnerDependencies = defaultDependencies) {
  const activeBatches = new Map<string, ActiveBatch>()

  async function start(
    input: StartRequestBatchInput,
    options?: SendRequestOptions
  ): Promise<GenericResult<StartRequestBatchResponse>> {
    if (!Number.isInteger(input.concurrency) || input.concurrency <= 0) {
      return GenericError.Message('Batch concurrency must be a positive integer')
    }
    if (isBatchActive(input.batchId)) {
      return GenericError.Message('Request batch is already active')
    }

    const requestSnapshot = structuredClone(input.request)
    requestSnapshot.environmentSnapshot =
      requestSnapshot.environmentSnapshot ?? (await dependencies.loadEnvironmentSnapshot?.(requestSnapshot))
    const beginResult = await dependencies.begin({
      batchId: input.batchId,
      concurrency: input.concurrency,
      requestId: requestSnapshot.requestId,
    })
    if (!beginResult.success) {
      return beginResult
    }

    const state: ActiveBatch = {
      batchId: beginResult.data.batch.id,
      sourceBatchId: input.batchId,
      request: requestSnapshot,
      rows: beginResult.data.rows,
      concurrency: input.concurrency,
      activeExecutions: new Map(),
      isCancelling: false,
      completion: null,
    }
    activeBatches.set(state.batchId, state)
    emitBatchUpdated(dependencies, beginResult.data.batch)

    state.completion = executeBatch(dependencies, state, options).finally(() => {
      activeBatches.delete(state.batchId)
    })
    void state.completion.catch(error => console.error('request batch execution failed', error))

    return Result.Success({ batch: beginResult.data.batch })
  }

  async function runRow(
    input: RunRequestBatchRowInput,
    options?: SendRequestOptions
  ): Promise<GenericResult<RunRequestBatchRowResponse>> {
    if (isBatchActive(input.batchId)) {
      return GenericError.Message('Request batch is already active')
    }

    const requestSnapshot = structuredClone(input.request)
    requestSnapshot.environmentSnapshot =
      requestSnapshot.environmentSnapshot ?? (await dependencies.loadEnvironmentSnapshot?.(requestSnapshot))
    const beginResult = await dependencies.beginRow({
      batchId: input.batchId,
      rowId: input.rowId,
      requestId: requestSnapshot.requestId,
    })
    if (!beginResult.success) return beginResult

    const state: ActiveBatch = {
      batchId: input.batchId,
      sourceBatchId: input.batchId,
      request: requestSnapshot,
      rows: [beginResult.data.row],
      concurrency: 1,
      activeExecutions: new Map(),
      isCancelling: false,
      completion: null,
    }
    activeBatches.set(state.batchId, state)
    emitBatchUpdated(dependencies, beginResult.data.batch)
    emitRowUpdated(dependencies, beginResult.data.batch, beginResult.data.row)
    state.completion = executeBatch(dependencies, state, options).finally(() => activeBatches.delete(state.batchId))
    void state.completion.catch(error => console.error('request batch row execution failed', error))
    return Result.Success(beginResult.data)
  }

  async function cancel(input: CancelRequestBatchInput): Promise<GenericResult<void>> {
    const state = activeBatches.get(input.batchId)
    if (!state) {
      return GenericError.Message('Request batch is not active')
    }

    state.isCancelling = true
    const pendingResult = await dependencies.cancelPendingRows(
      state.batchId,
      state.rows.map(row => row.id)
    )
    if (!pendingResult.success) {
      return pendingResult
    }
    emitBatchUpdated(dependencies, pendingResult.data)
    await Promise.all(
      Array.from(state.activeExecutions, ([executionId]) =>
        dependencies.cancel({ requestId: state.request.requestId, executionId })
      )
    )
    return Result.Success(undefined)
  }

  function listActive(): ActiveRequestBatchState[] {
    return Array.from(activeBatches.values(), state => ({
      batchId: state.batchId,
      isCancelling: state.isCancelling,
      activeRowIds: Array.from(state.activeExecutions.values()),
    }))
  }

  async function waitForCompletion(batchId: string) {
    await activeBatches.get(batchId)?.completion
  }

  async function recoverStale(): Promise<GenericResult<RequestBatchRecord[]>> {
    const result = await dependencies.recoverStale()
    if (result.success) {
      for (const batch of result.data) {
        emitBatchUpdated(dependencies, batch)
      }
    }
    return result
  }

  function isBatchActive(batchId: string) {
    return Array.from(activeBatches.values()).some(
      state => state.batchId === batchId || state.sourceBatchId === batchId
    )
  }

  return { start, runRow, cancel, listActive, waitForCompletion, recoverStale }
}

const requestBatchRunner = createRequestBatchRunner()

export const startRequestBatch = requestBatchRunner.start
export const runRequestBatchRow = requestBatchRunner.runRow
export const cancelRequestBatch = requestBatchRunner.cancel
export const listActiveRequestBatches = requestBatchRunner.listActive
export const waitForRequestBatchCompletion = requestBatchRunner.waitForCompletion
export const recoverStaleRequestBatches = requestBatchRunner.recoverStale

async function executeBatch(
  dependencies: RequestBatchRunnerDependencies,
  state: ActiveBatch,
  options: SendRequestOptions | undefined
) {
  let nextRowIndex = 0
  const workerCount = Math.min(state.concurrency, state.rows.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const row = state.rows[nextRowIndex]
      nextRowIndex += 1
      if (!row) {
        return
      }
      if (state.isCancelling) {
        return
      }
      await executeRow(dependencies, state, row, options)
    }
  })
  const workerResults = await Promise.allSettled(workers)
  const workerFailed = workerResults.some(result => result.status === 'rejected')

  if (workerFailed && !state.isCancelling) {
    const pendingResult = await dependencies.cancelPendingRows(
      state.batchId,
      state.rows.map(row => row.id)
    )
    if (pendingResult.success) {
      emitBatchUpdated(dependencies, pendingResult.data)
    }
  }

  const finishResult = await dependencies.finish({ batchId: state.batchId })
  if (!finishResult.success) {
    throw new Error('Failed to persist request batch completion')
  }
  emitBatchUpdated(dependencies, finishResult.data)
}

async function executeRow(
  dependencies: RequestBatchRunnerDependencies,
  state: ActiveBatch,
  row: RequestBatchRowRecord,
  options: SendRequestOptions | undefined
) {
  const executionId = dependencies.createExecutionId()
  state.activeExecutions.set(executionId, row.id)
  const startedAt = Date.now()
  const startedResult = await dependencies.updateRow({
    id: row.id,
    status: 'running',
    historyId: null,
    startedAt,
    completedAt: null,
  })
  if (!startedResult.success) {
    state.activeExecutions.delete(executionId)
    throw new Error('Failed to persist request batch row start')
  }
  emitRowUpdated(dependencies, startedResult.data.batch, startedResult.data.row)

  if (state.isCancelling) {
    state.activeExecutions.delete(executionId)
    await finishRow(dependencies, row.id, 'cancelled', null)
    return
  }

  try {
    const result = await dependencies.send(toRowSendRequestInput(state, row, executionId), options)
    await finishRow(
      dependencies,
      row.id,
      state.isCancelling ? 'cancelled' : result.success ? 'completed' : 'failed',
      result.success ? result.data.execution.id : null
    )
  } catch {
    await finishRow(dependencies, row.id, state.isCancelling ? 'cancelled' : 'failed', null)
  } finally {
    state.activeExecutions.delete(executionId)
  }
}

async function finishRow(
  dependencies: RequestBatchRunnerDependencies,
  rowId: string,
  status: 'completed' | 'failed' | 'cancelled',
  historyId: string | null
) {
  const result = await dependencies.updateRow({ id: rowId, status, historyId, completedAt: Date.now() })
  if (!result.success) {
    throw new Error('Failed to persist request batch row completion')
  }
  emitRowUpdated(dependencies, result.data.batch, result.data.row)
}

function toRowSendRequestInput(state: ActiveBatch, row: RequestBatchRowRecord, executionId: string): SendRequestInput {
  return {
    ...state.request,
    executionId,
    immutableVariables: { ...row.variables },
    saveToHistory: true,
    folderRunId: undefined,
    folderRunFolderId: undefined,
    requestBatchId: state.batchId,
    requestBatchRowId: row.id,
    suppressSseEvents: true,
    requestMetadata: {
      sourceRuntime: 'request-batch',
      isRetry: false,
      retryCount: 0,
    },
  }
}

function emitBatchUpdated(dependencies: RequestBatchRunnerDependencies, batch: RequestBatchRecord) {
  dependencies.emit({
    type: 'request-batch-updated',
    batchId: batch.id,
    status: batch.status,
    summary: batch.summary,
    startedAt: batch.startedAt,
    completedAt: batch.completedAt,
  })
}

function emitRowUpdated(
  dependencies: RequestBatchRunnerDependencies,
  batch: RequestBatchRecord,
  row: RequestBatchRowRecord
) {
  dependencies.emit({
    type: 'request-batch-row-updated',
    batchId: row.batchId,
    rowId: row.id,
    status: row.status,
    historyId: row.historyId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  })
  emitBatchUpdated(dependencies, batch)
}
