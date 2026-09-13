import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as electron from '@/getWindowElectron'
import type { RequestBatchRecord, RequestBatchRowRecord } from '@common/RequestBatches'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { buildSendRequestInput } from './requestSendInput'
import { REQUEST_BATCH_ROW_PAGE_SIZE, RequestBatchCoordinator, requestBatchStore } from './requestBatchStore'

describe('request batch frontend state', () => {
  it('persists a global custom page size and uses it for every batch with status filtering', async () => {
    const first = createBatch('global-size-first')
    const second = createBatch('global-size-second')
    const getRequestBatch = vi.fn().mockImplementation(async ({ id }: { id: string }) => ({
      success: true,
      data: {
        batch: id === first.id ? first : second,
        rows: [],
        nextRowOffset: null,
        totalRowCount: 0,
      },
    }))
    const spy = vi.spyOn(electron, 'getWindowElectron').mockReturnValue({
      ...electron.getWindowElectron(),
      getRequestBatch,
    })
    const previousSize = requestBatchStore.getSnapshot().context.rowPageSize
    try {
      requestBatchStore.trigger.batchesLoaded({ requestId: first.requestId, batches: [first] })
      requestBatchStore.trigger.batchesLoaded({ requestId: second.requestId, batches: [second] })
      RequestBatchCoordinator.setRowPageSize(237)
      expect(localStorage.getItem('request-batch-rows-per-page')).toBe('237')
      await RequestBatchCoordinator.loadPage(first.id, 'customer', 0, undefined, 'failed')
      await RequestBatchCoordinator.loadPage(second.id, '', 0)
      expect(getRequestBatch).toHaveBeenNthCalledWith(1, {
        id: first.id, rowSearchQuery: 'customer', rowOffset: 0, rowLimit: 237, rowStatus: 'failed',
      })
      expect(getRequestBatch).toHaveBeenNthCalledWith(2, {
        id: second.id, rowSearchQuery: '', rowOffset: 0, rowLimit: 237, rowStatus: undefined,
      })
      await RequestBatchCoordinator.loadPage(first.id, 'customer', 0, undefined, null)
      expect(requestBatchStore.getSnapshot().context.pageByBatchId[first.id].rowFilter).toBeNull()
      expect(getRequestBatch).toHaveBeenLastCalledWith({
        id: first.id, rowSearchQuery: 'customer', rowOffset: 0, rowLimit: 237, rowStatus: undefined,
      })
    } finally {
      spy.mockRestore()
      RequestBatchCoordinator.setRowPageSize(previousSize)
    }
  })

  it('ignores stale results after changing the status filter', () => {
    const batch = createBatch('batch-filter-race')
    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 50, rowSearchQuery: '', rowFilter: 'failed' })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 50, rowSearchQuery: '', rowFilter: 'completed' })
    requestBatchStore.trigger.pageLoaded({
      batch, rows: [createRow(batch.id, 0)], rowOffset: 0, rowPageSize: 50,
      nextRowOffset: null, totalRowCount: 1, rowSearchQuery: '', rowFilter: 'failed',
    })
    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.rowFilter).toBe('completed')
    expect(page.loading).toBe(true)
    expect(page.rows).toEqual([])
  })

  it('keeps only the loaded 50-row page and applies live row and summary updates', () => {
    const batch = createBatch('batch-state-test')
    const rows = Array.from({ length: REQUEST_BATCH_ROW_PAGE_SIZE }, (_, index) => createRow(batch.id, index))

    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 50, rowPageSize: 50, rowSearchQuery: 'customer' })
    requestBatchStore.trigger.pageLoaded({
      batch,
      rows,
      rowOffset: 50,
      rowPageSize: 50,
      nextRowOffset: 100,
      totalRowCount: 140,
      rowSearchQuery: 'customer',
    })
    requestBatchStore.trigger.rowUpdated({
      batchId: batch.id,
      rowId: rows[0].id,
      status: 'completed',
      historyId: 'history-1',
      startedAt: 10,
      completedAt: 20,
    })
    requestBatchStore.trigger.batchUpdated({
      batchId: batch.id,
      status: 'running',
      summary: { ...batch.summary, pendingCount: 139, completedCount: 1 },
      startedAt: 10,
      completedAt: null,
    })

    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.rows).toHaveLength(50)
    expect(page.rowOffset).toBe(50)
    expect(page.rowSearchQuery).toBe('customer')
    expect(page.rows[0]).toMatchObject({ status: 'completed', historyId: 'history-1' })
    expect(page.batch.summary.completedCount).toBe(1)
  })

  it('maps the current unsaved draft and execution settings without dropping request fields', () => {
    const draft = createDraft()

    const input = buildSendRequestInput({
      requestId: 'request-draft-test',
      draft,
      activeEnvironmentIds: ['environment-2', 'environment-1'],
      historyKeepLast: 731,
    })

    expect(input).toMatchObject({
      requestId: 'request-draft-test',
      method: 'PATCH',
      url: 'https://example.test/{{tenant}}',
      body: '{"unsaved":true}',
      testScript: 'kova.test("draft", () => {})',
      activeEnvironmentIds: ['environment-2', 'environment-1'],
      historyKeepLast: 731,
      saveToHistory: false,
    })
  })

  it('ignores a stale page response after the requested search changes', () => {
    const batch = createBatch('batch-stale-page-test')

    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 50, rowSearchQuery: 'first' })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 50, rowSearchQuery: 'second' })
    requestBatchStore.trigger.pageLoaded({
      batch,
      rows: [createRow(batch.id, 0)],
      rowOffset: 0,
      rowPageSize: 50,
      nextRowOffset: null,
      totalRowCount: 1,
      rowSearchQuery: 'first',
    })

    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.loading).toBe(true)
    expect(page.rowSearchQuery).toBe('second')
    expect(page.rows).toEqual([])
  })

  it('ignores stale responses and failures after changing the page size', () => {
    const batch = createBatch('batch-page-size-test')
    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 50, rowSearchQuery: '' })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: 17, rowSearchQuery: '' })
    requestBatchStore.trigger.pageLoaded({
      batch,
      rows: [createRow(batch.id, 0)],
      rowOffset: 0,
      rowPageSize: 50,
      nextRowOffset: 50,
      totalRowCount: 140,
      rowSearchQuery: '',
    })
    requestBatchStore.trigger.pageLoadFailed({ batchId: batch.id, rowOffset: 0, rowPageSize: 50, rowSearchQuery: '' })
    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.rowPageSize).toBe(17)
    expect(page.loading).toBe(true)
    expect(page.rows).toEqual([])
  })

  it('does not regress a live batch update when an older start response arrives', () => {
    const batch = createBatch('batch-start-race-test')

    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.batchUpdated({
      batchId: batch.id,
      status: 'completed',
      summary: { ...batch.summary, pendingCount: 0, completedCount: batch.rowCount },
      startedAt: 10,
      completedAt: 20,
    })
    requestBatchStore.trigger.batchImported({ batch: { ...batch, status: 'running', updatedAt: 2 } })

    const storedBatch = requestBatchStore.getSnapshot().context.batchesByRequestId[batch.requestId][0]
    expect(storedBatch.status).toBe('completed')
    expect(storedBatch.summary.completedCount).toBe(batch.rowCount)
  })
})

describe('throttled batch progress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function loadBatch(id: string, rowCount: number) {
    const batch = createBatch(id)
    const rows = Array.from({ length: rowCount }, (_, index) => createRow(batch.id, index))
    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowPageSize: rowCount, rowSearchQuery: '' })
    requestBatchStore.trigger.pageLoaded({
      batch, rows, rowOffset: 0, rowPageSize: rowCount,
      nextRowOffset: null, totalRowCount: rowCount, rowSearchQuery: '',
    })
    return { batch, rows }
  }

  it('coalesces a burst of row and summary events into one store update with the latest values', () => {
    const { batch, rows } = loadBatch('throttle-burst', 1001)
    const listener = vi.fn()
    const subscription = requestBatchStore.subscribe(listener)
    try {
      for (let index = 0; index < 1000; index++) {
        RequestBatchCoordinator.queueRowUpdate({
          batchId: batch.id, rowId: rows[index].id, status: 'running',
          historyId: null, startedAt: 10, completedAt: null,
        })
        RequestBatchCoordinator.queueRowUpdate({
          batchId: batch.id, rowId: rows[index].id, status: 'completed',
          historyId: `history-${index}`, startedAt: 10, completedAt: 20,
        })
        RequestBatchCoordinator.queueBatchUpdate({
          batchId: batch.id, status: 'running', startedAt: 10, completedAt: null,
          summary: { ...batch.summary, totalCount: 1001, pendingCount: 1000 - index, completedCount: index + 1 },
        })
      }
      vi.advanceTimersByTime(299)
      expect(listener).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(listener).toHaveBeenCalledTimes(1)
      const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
      expect(page.rows.slice(0, 1000).every(row => row.status === 'completed')).toBe(true)
      expect(page.rows[999].historyId).toBe('history-999')
      expect(page.rows[1000]).toBe(rows[1000])
      expect(page.batch.summary.completedCount).toBe(1000)
      vi.advanceTimersByTime(1000)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      subscription.unsubscribe()
    }
  })

  it('keeps updating every 300 ms during a continuous stream across multiple batches', () => {
    const first = loadBatch('throttle-first', 1)
    const second = loadBatch('throttle-second', 1)
    const listener = vi.fn()
    const subscription = requestBatchStore.subscribe(listener)
    try {
      for (let index = 0; index < 6; index++) {
        for (const { batch, rows } of [first, second]) {
          RequestBatchCoordinator.queueRowUpdate({
            batchId: batch.id, rowId: rows[0].id, status: 'completed',
            historyId: `history-${index}`, startedAt: 10, completedAt: 20,
          })
        }
        vi.advanceTimersByTime(100)
        expect(listener).toHaveBeenCalledTimes(Math.floor((index + 1) / 3))
      }
      for (const { batch } of [first, second]) {
        expect(requestBatchStore.getSnapshot().context.pageByBatchId[batch.id].rows[0].historyId).toBe('history-5')
      }
    } finally {
      subscription.unsubscribe()
    }
  })

  it('applies the final state and refreshes the completed batch once after the trailing flush', () => {
    const { batch, rows } = loadBatch('throttle-finished', 1)
    const reload = vi.spyOn(RequestBatchCoordinator, 'loadPage').mockResolvedValue(undefined)
    RequestBatchCoordinator.queueRowUpdate({
      batchId: batch.id, rowId: rows[0].id, status: 'http-error',
      historyId: 'error-history', startedAt: 10, completedAt: 20,
    })
    for (const status of ['running', 'failed', 'failed'] as const) {
      RequestBatchCoordinator.queueBatchUpdate({
        batchId: batch.id, status, startedAt: 10, completedAt: status === 'running' ? null : 20,
        summary: { ...batch.summary, totalCount: 1, pendingCount: 0, httpErrorCount: 1 },
      })
    }
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(reload).toHaveBeenCalledExactlyOnceWith(batch.id, '', 0)
    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.batch.status).toBe('failed')
    expect(page.batch.summary.httpErrorCount).toBe(1)
    expect(page.rows[0]).toMatchObject({ status: 'http-error', historyId: 'error-history' })
  })
})

function createBatch(id: string): RequestBatchRecord {
  return {
    id,
    requestId: `request-${id}`,
    requestName: 'Customers',
    name: 'customers.csv',
    sourceFileName: 'customers.csv',
    sourceType: 'csv',
    sheetName: null,
    columns: ['customer'],
    rowCount: 140,
    status: 'ready',
    concurrency: null,
    summary: {
      totalCount: 140,
      pendingCount: 140,
      runningCount: 0,
      completedCount: 0,
      httpErrorCount: 0,
      failedCount: 0,
      cancelledCount: 0,
    },
    startedAt: null,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createRow(batchId: string, rowIndex: number): RequestBatchRowRecord {
  return {
    id: `${batchId}-row-${rowIndex}`,
    batchId,
    rowIndex,
    variables: { customer: `customer-${rowIndex}` },
    status: 'pending',
    historyId: null,
    startedAt: null,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function createDraft(): RequestDetailsDraft {
  return {
    itemType: 'request',
    name: 'Unsaved customers request',
    requestType: 'http',
    method: 'PATCH',
    url: 'https://example.test/{{tenant}}',
    pathParams: '[]',
    searchParams: '[]',
    auth: { type: 'noauth' },
    preRequestScript: 'kova.variables.set("draft", "yes")',
    postRequestScript: '',
    testScript: 'kova.test("draft", () => {})',
    responseVisualizer: '',
    responseTableAccessor: '',
    preferredResponseBodyView: 'raw',
    headers: '[]',
    body: '{"unsaved":true}',
    bodyType: 'raw',
    rawType: 'json',
    graphqlQuery: '',
    graphqlVariables: '',
    graphqlSchema: '',
    tlsVerificationMode: 'inherit',
    websocketSubprotocols: '',
    websocketOnOpenMessage: '',
    websocketAutoSendEnabled: false,
    websocketAutoSendMessage: '',
    websocketAutoSendIntervalSeconds: 1,
    mcpTransport: 'http',
    mcpServerUrl: '',
    mcpAccessToken: '',
    mcpSelectedToolName: '',
    mcpSelectedResourceUri: '',
    mcpSelectedPromptName: '',
    mcpArguments: '',
    mcpIntrospection: '',
    saveToHistory: false,
  }
}
