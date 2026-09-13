import { describe, expect, it, vi } from 'vitest'
import type { GenericEvent } from '../common/GenericEvent.js'
import { GenericError } from '../common/GenericError.js'
import type { RequestBatchRecord, RequestBatchRowRecord, RequestBatchSummary } from '../common/RequestBatches.js'
import type { SendRequestInput, SendRequestResponse } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { createRequestBatchRunner, type RequestBatchRunnerDependencies } from './request-batch-runner.js'

describe('request batch runner', () => {
  it('bounds concurrency and sends an immutable snapshot for every row', async () => {
    let activeCount = 0
    let maximumActiveCount = 0
    const sentInputs: SendRequestInput[] = []
    const harness = createHarness(5, async input => {
      sentInputs.push(input)
      activeCount += 1
      maximumActiveCount = Math.max(maximumActiveCount, activeCount)
      await new Promise(resolve => setTimeout(resolve, 5))
      activeCount -= 1
      return successfulSend(input.executionId ?? '')
    })
    const request = createSendRequestInput()

    const startResult = await harness.runner.start({ batchId: 'batch-1', concurrency: 2, request })
    request.url = 'https://changed.example.com'
    await harness.runner.waitForCompletion('batch-1')

    expect(startResult.success).toBe(true)
    expect(maximumActiveCount).toBe(2)
    expect(sentInputs).toHaveLength(5)
    expect(sentInputs.every(input => input.url === 'https://example.com')).toBe(true)
    expect(sentInputs.map(input => input.immutableVariables)).toEqual(
      Array.from({ length: 5 }, (_, index) => ({ value: String(index) }))
    )
    expect(sentInputs.every(input => input.saveToHistory && input.suppressSseEvents)).toBe(true)
    expect(sentInputs.every(input => input.requestMetadata?.sourceRuntime === 'request-batch')).toBe(true)
    expect(new Set(sentInputs.map(input => input.executionId)).size).toBe(5)
    expect(harness.batch.status).toBe('completed')
    expect(harness.batch.summary.completedCount).toBe(5)
    expect(harness.rows.map(row => row.historyId)).toEqual([
      'execution-1',
      'execution-2',
      'execution-3',
      'execution-4',
      'execution-5',
    ])
  })

  it('keeps failed rows without history and fails the batch', async () => {
    const harness = createHarness(2, async input =>
      input.immutableVariables?.value === '0'
        ? GenericError.Message('send failed')
        : successfulSend(input.executionId ?? '')
    )

    await harness.runner.start({ batchId: 'batch-1', concurrency: 1, request: createSendRequestInput() })
    await harness.runner.waitForCompletion('batch-1')

    expect(harness.batch.status).toBe('failed')
    expect(harness.rows[0]).toMatchObject({ status: 'failed', historyId: null })
    expect(harness.rows[1]).toMatchObject({ status: 'completed', historyId: 'execution-2' })
  })

  it.each([
    [200, 'completed'],
    [204, 'completed'],
    [299, 'completed'],
    [300, 'http-error'],
    [304, 'http-error'],
    [400, 'http-error'],
    [404, 'http-error'],
    [500, 'http-error'],
    [503, 'http-error'],
  ] as const)('classifies HTTP %i as %s and preserves response history', async (status, expectedStatus) => {
    const harness = createHarness(1, async input => successfulSend(input.executionId ?? '', status))
    await harness.runner.start({ batchId: 'batch-1', concurrency: 1, request: createSendRequestInput() })
    await harness.runner.waitForCompletion('batch-1')

    const httpError = expectedStatus === 'http-error'
    expect(harness.rows[0]).toMatchObject({ status: expectedStatus, historyId: 'execution-1' })
    expect(harness.batch.summary).toMatchObject({
      completedCount: httpError ? 0 : 1,
      httpErrorCount: httpError ? 1 : 0,
      failedCount: 0,
      runningCount: 0,
    })
    expect(harness.batch.status).toBe(httpError ? 'failed' : 'completed')
    expect(harness.events).toContainEqual(expect.objectContaining({
      type: 'request-batch-row-updated', status: expectedStatus, historyId: 'execution-1',
    }))
  })

  it('marks a saved execution without a response as failed and preserves its history', async () => {
    const harness = createHarness(1, async input => Result.Success({
      execution: { id: input.executionId, response: null, responseError: 'Connection refused' },
    } as SendRequestResponse))
    await harness.runner.start({ batchId: 'batch-1', concurrency: 1, request: createSendRequestInput() })
    await harness.runner.waitForCompletion('batch-1')
    expect(harness.rows[0]).toMatchObject({ status: 'failed', historyId: 'execution-1' })
    expect(harness.batch.summary).toMatchObject({ failedCount: 1, httpErrorCount: 0, completedCount: 0 })
  })

  it('replaces an HTTP error with completed when a row rerun succeeds', async () => {
    let status = 500
    const harness = createHarness(1, async input => successfulSend(input.executionId ?? '', status))
    await harness.runner.start({ batchId: 'batch-1', concurrency: 1, request: createSendRequestInput() })
    await harness.runner.waitForCompletion('batch-1')
    expect(harness.batch.summary.httpErrorCount).toBe(1)

    status = 200
    await harness.runner.runRow({ batchId: 'batch-1', rowId: 'row-0', request: createSendRequestInput() })
    await harness.runner.waitForCompletion('batch-1')
    expect(harness.rows[0]).toMatchObject({ status: 'completed', historyId: 'execution-2' })
    expect(harness.batch.summary).toMatchObject({ httpErrorCount: 0, completedCount: 1 })
  })

  it('cancels the exact active execution and queued rows', async () => {
    let releaseSend: (() => void) | undefined
    const harness = createHarness(3, async () => {
      await new Promise<void>(resolve => {
        releaseSend = resolve
      })
      return GenericError.Message('Request cancelled')
    })
    harness.dependencies.cancel = vi.fn(async () => {
      releaseSend?.()
      return Result.Success(undefined)
    })

    await harness.runner.start({ batchId: 'batch-1', concurrency: 1, request: createSendRequestInput() })
    await waitUntil(() => releaseSend !== undefined)
    const cancelResult = await harness.runner.cancel({ batchId: 'batch-1' })
    await harness.runner.waitForCompletion('batch-1')

    expect(cancelResult.success).toBe(true)
    expect(harness.dependencies.cancel).toHaveBeenCalledWith({ requestId: 'request-1', executionId: 'execution-1' })
    expect(harness.rows.every(row => row.status === 'cancelled')).toBe(true)
    expect(harness.batch.status).toBe('cancelled')
  })

  it('rejects invalid concurrency without starting persistence', async () => {
    const harness = createHarness(1, async input => successfulSend(input.executionId ?? ''))
    const result = await harness.runner.start({ batchId: 'batch-1', concurrency: 0, request: createSendRequestInput() })
    expect(result.success).toBe(false)
    expect(harness.dependencies.begin).not.toHaveBeenCalled()
  })

  it('runs only the selected row and leaves the remaining rows pending', async () => {
    const sentInputs: SendRequestInput[] = []
    const harness = createHarness(3, async input => {
      sentInputs.push(input)
      return successfulSend(input.executionId ?? '')
    })

    const result = await harness.runner.runRow({
      batchId: 'batch-1',
      rowId: 'row-1',
      request: createSendRequestInput(),
    })
    await harness.runner.waitForCompletion('batch-1')

    expect(result.success).toBe(true)
    expect(sentInputs).toHaveLength(1)
    expect(sentInputs[0]).toMatchObject({
      requestBatchId: 'batch-1',
      requestBatchRowId: 'row-1',
      immutableVariables: { value: '1' },
    })
    expect(harness.rows[1]).toMatchObject({ status: 'completed', historyId: 'execution-1' })
    expect(harness.rows[0].status).toBe('pending')
    expect(harness.rows[2].status).toBe('pending')
    expect(harness.batch.status).toBe('ready')
  })
})

function createHarness(rowCount: number, send: RequestBatchRunnerDependencies['send']) {
  const now = Date.now()
  const rows: RequestBatchRowRecord[] = Array.from({ length: rowCount }, (_, index) => ({
    id: `row-${index}`,
    batchId: 'batch-1',
    rowIndex: index,
    variables: { value: String(index) },
    status: 'pending',
    historyId: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }))
  const batch: RequestBatchRecord = {
    id: 'batch-1',
    requestId: 'request-1',
    requestName: 'Request',
    name: 'Batch',
    sourceFileName: 'rows.csv',
    sourceType: 'csv',
    sheetName: null,
    columns: ['value'],
    rowCount,
    status: 'ready',
    concurrency: null,
    summary: buildSummary(rows),
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  let executionNumber = 0
  const events: GenericEvent[] = []
  const dependencies: RequestBatchRunnerDependencies = {
    begin: vi.fn(async input => {
      batch.status = 'running'
      batch.concurrency = input.concurrency
      batch.startedAt = Date.now()
      return Result.Success({ batch: structuredClone(batch), rows: structuredClone(rows) })
    }),
    beginRow: vi.fn(async input => {
      const row = rows.find(candidate => candidate.id === input.rowId)
      if (!row) return GenericError.Message('Request batch row not found')
      row.status = 'pending'
      row.historyId = null
      row.startedAt = null
      row.completedAt = null
      batch.status = 'running'
      batch.concurrency = 1
      batch.summary = buildSummary(rows)
      return Result.Success({ batch: structuredClone(batch), row: structuredClone(row) })
    }),
    updateRow: vi.fn(async input => {
      const row = rows.find(candidate => candidate.id === input.id)
      if (!row) {
        return GenericError.Message('Request batch row not found')
      }
      row.status = input.status
      row.historyId = input.historyId
      if (input.startedAt !== undefined) row.startedAt = input.startedAt
      if (input.completedAt !== undefined) row.completedAt = input.completedAt
      batch.summary = buildSummary(rows)
      return Result.Success({ batch: structuredClone(batch), row: structuredClone(row) })
    }),
    cancelPendingRows: vi.fn(async (_batchId, rowIds) => {
      for (const row of rows) {
        if (rowIds.includes(row.id) && row.status === 'pending') {
          row.status = 'cancelled'
          row.completedAt = Date.now()
        }
      }
      batch.summary = buildSummary(rows)
      return Result.Success(structuredClone(batch))
    }),
    finish: vi.fn(async () => {
      const summary = buildSummary(rows)
      batch.status =
        summary.failedCount > 0 || summary.httpErrorCount > 0
          ? 'failed'
          : summary.cancelledCount > 0
            ? 'cancelled'
            : summary.pendingCount > 0
              ? 'ready'
              : 'completed'
      batch.completedAt = Date.now()
      batch.summary = summary
      return Result.Success(structuredClone(batch))
    }),
    recoverStale: vi.fn(async () => Result.Success([])),
    send,
    cancel: vi.fn(async () => Result.Success(undefined)),
    emit: event => events.push(event),
    createExecutionId: () => `execution-${++executionNumber}`,
  }
  return { runner: createRequestBatchRunner(dependencies), dependencies, batch, rows, events }
}

function buildSummary(rows: RequestBatchRowRecord[]): RequestBatchSummary {
  return {
    totalCount: rows.length,
    pendingCount: rows.filter(row => row.status === 'pending').length,
    runningCount: rows.filter(row => row.status === 'running').length,
    completedCount: rows.filter(row => row.status === 'completed').length,
    httpErrorCount: rows.filter(row => row.status === 'http-error').length,
    failedCount: rows.filter(row => row.status === 'failed').length,
    cancelledCount: rows.filter(row => row.status === 'cancelled').length,
  }
}

function successfulSend(executionId: string, status = 200) {
  return Result.Success({ execution: { id: executionId, response: { status }, responseError: null } } as SendRequestResponse)
}

function createSendRequestInput(): SendRequestInput {
  return {
    requestId: 'request-1',
    method: 'GET',
    url: 'https://example.com',
    pathParams: '',
    searchParams: '',
    auth: { type: 'noauth' },
    preRequestScript: '',
    postRequestScript: '',
    testScript: '',
    headers: '',
    body: '',
    bodyType: 'none',
    rawType: 'json',
    activeEnvironmentIds: [],
    tlsVerificationMode: 'inherit',
    saveToHistory: false,
    historyKeepLast: 100,
  }
}

async function waitUntil(predicate: () => boolean) {
  while (!predicate()) {
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}
