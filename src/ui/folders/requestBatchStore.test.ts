import { describe, expect, it } from 'vitest'
import type { RequestBatchRecord, RequestBatchRowRecord } from '@common/RequestBatches'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { buildSendRequestInput } from './requestSendInput'
import { REQUEST_BATCH_ROW_PAGE_SIZE, requestBatchStore } from './requestBatchStore'

describe('request batch frontend state', () => {
  it('keeps only the loaded 50-row page and applies live row and summary updates', () => {
    const batch = createBatch('batch-state-test')
    const rows = Array.from({ length: REQUEST_BATCH_ROW_PAGE_SIZE }, (_, index) => createRow(batch.id, index))

    requestBatchStore.trigger.batchesLoaded({ requestId: batch.requestId, batches: [batch] })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 50, rowSearchQuery: 'customer' })
    requestBatchStore.trigger.pageLoaded({
      batch,
      rows,
      rowOffset: 50,
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
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowSearchQuery: 'first' })
    requestBatchStore.trigger.pageLoading({ batch, rowOffset: 0, rowSearchQuery: 'second' })
    requestBatchStore.trigger.pageLoaded({
      batch,
      rows: [createRow(batch.id, 0)],
      rowOffset: 0,
      nextRowOffset: null,
      totalRowCount: 1,
      rowSearchQuery: 'first',
    })

    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batch.id]
    expect(page.loading).toBe(true)
    expect(page.rowSearchQuery).toBe('second')
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
