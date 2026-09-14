import { createStore } from '@xstate/store'
import type { GenericEvent } from '@common/GenericEvent'
import type { ImportRequestBatchFileInput, RequestBatchRecord, RequestBatchRowRecord } from '@common/RequestBatches'
import type { SendRequestInput } from '@common/Requests'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

export const REQUEST_BATCH_ROW_PAGE_SIZE = 50
const REQUEST_BATCH_LIST_PAGE_SIZE = 100
const ROW_PAGE_SIZE_STORAGE_KEY = 'request-batch-rows-per-page'
const ROW_DETAIL_VIEW_STORAGE_KEY = 'request-batch-row-detail-view'
export type RequestBatchRowDetailView = 'response-panel' | 'history-view'
export type RequestBatchRowFilter = RequestBatchRowRecord['status'] | 'all' | null
type BatchUpdate = Omit<Extract<GenericEvent, { type: 'request-batch-updated' }>, 'type'>
type RowUpdate = Omit<Extract<GenericEvent, { type: 'request-batch-row-updated' }>, 'type'>
type ProgressUpdates = {
  batches: Map<string, BatchUpdate>
  rows: Map<string, Map<string, RowUpdate>>
}

function loadRowDetailView(): RequestBatchRowDetailView {
  try {
    return localStorage.getItem(ROW_DETAIL_VIEW_STORAGE_KEY) === 'history-view' ? 'history-view' : 'response-panel'
  } catch {
    return 'response-panel'
  }
}

function loadRowPageSize() {
  try {
    const size = Number(localStorage.getItem(ROW_PAGE_SIZE_STORAGE_KEY))
    if (Number.isSafeInteger(size) && size > 0) return size
  } catch {
    return REQUEST_BATCH_ROW_PAGE_SIZE
  }
  return REQUEST_BATCH_ROW_PAGE_SIZE
}

export type RequestBatchPage = {
  batch: RequestBatchRecord
  rows: RequestBatchRowRecord[]
  rowOffset: number
  rowPageSize: number
  nextRowOffset: number | null
  totalRowCount: number
  rowSearchQuery: string
  rowFilter: RequestBatchRowFilter
  loading: boolean
}

type RequestBatchContext = {
  rowPageSize: number
  rowDetailView: RequestBatchRowDetailView
  batchesByRequestId: Record<string, RequestBatchRecord[]>
  loadingByRequestId: Record<string, boolean>
  selectedBatchIdByRequestId: Record<string, string | null>
  pageByBatchId: Record<string, RequestBatchPage>
}

export const requestBatchStore = createStore({
  context: {
    rowPageSize: loadRowPageSize(),
    rowDetailView: loadRowDetailView(),
    batchesByRequestId: {},
    loadingByRequestId: {},
    selectedBatchIdByRequestId: {},
    pageByBatchId: {},
  } as RequestBatchContext,
  on: {
    concurrencyUpdated: (context, event: { batchId: string; concurrency: number }) => {
      const batch = findBatch(context, event.batchId)
      if (!batch) return context
      const updatedBatch = { ...batch, concurrency: event.concurrency }
      const page = context.pageByBatchId[event.batchId]
      return {
        ...replaceBatch(context, updatedBatch),
        pageByBatchId: page
          ? { ...context.pageByBatchId, [event.batchId]: { ...page, batch: updatedBatch } }
          : context.pageByBatchId,
      }
    },
    progressUpdated: (context, event: ProgressUpdates) => applyProgressUpdates(context, event),
    rowPageSizeChanged: (context, event: { size: number }) => ({ ...context, rowPageSize: event.size }),
    rowDetailViewChanged: (context, event: { view: RequestBatchRowDetailView }) => ({ ...context, rowDetailView: event.view }),
    batchesLoading: (context, event: { requestId: string }) => ({
      ...context,
      loadingByRequestId: { ...context.loadingByRequestId, [event.requestId]: true },
    }),
    batchesLoaded: (context, event: { requestId: string; batches: RequestBatchRecord[] }) => ({
      ...context,
      batchesByRequestId: { ...context.batchesByRequestId, [event.requestId]: event.batches },
      loadingByRequestId: { ...context.loadingByRequestId, [event.requestId]: false },
      selectedBatchIdByRequestId: {
        ...context.selectedBatchIdByRequestId,
        [event.requestId]: getSelectedBatchId(context, event.requestId, event.batches),
      },
    }),
    batchesLoadFailed: (context, event: { requestId: string }) => ({
      ...context,
      loadingByRequestId: { ...context.loadingByRequestId, [event.requestId]: false },
    }),
    batchSelected: (context, event: { requestId: string; batchId: string }) => ({
      ...context,
      selectedBatchIdByRequestId: { ...context.selectedBatchIdByRequestId, [event.requestId]: event.batchId },
    }),
    pageLoading: (context, event: { batch: RequestBatchRecord; rowOffset: number; rowPageSize: number; rowSearchQuery: string; rowFilter?: RequestBatchRowFilter }) => ({
      ...context,
      pageByBatchId: {
        ...context.pageByBatchId,
        [event.batch.id]: {
          batch: event.batch,
          rows: context.pageByBatchId[event.batch.id]?.rows ?? [],
          rowOffset: event.rowOffset,
          rowPageSize: event.rowPageSize,
          nextRowOffset: null,
          totalRowCount: context.pageByBatchId[event.batch.id]?.totalRowCount ?? event.batch.rowCount,
          rowSearchQuery: event.rowSearchQuery,
          rowFilter: event.rowFilter ?? null,
          loading: true,
        },
      },
    }),
    pageLoaded: (
      context,
      event: {
        batch: RequestBatchRecord
        rows: RequestBatchRowRecord[]
        rowOffset: number
        rowPageSize: number
        nextRowOffset: number | null
        totalRowCount: number
        rowSearchQuery: string
        rowFilter?: RequestBatchRowFilter
      }
    ) => {
      const pendingPage = context.pageByBatchId[event.batch.id]
      if (
        !pendingPage ||
        pendingPage.rowOffset !== event.rowOffset ||
        pendingPage.rowPageSize !== event.rowPageSize ||
        pendingPage.rowFilter !== (event.rowFilter ?? null) ||
        pendingPage.rowSearchQuery !== event.rowSearchQuery
      ) {
        return context
      }
      return {
        ...replaceBatch(context, event.batch),
        pageByBatchId: {
          ...context.pageByBatchId,
          [event.batch.id]: { ...event, rowFilter: event.rowFilter ?? null, loading: false },
        },
      }
    },
    pageLoadFailed: (context, event: { batchId: string; rowOffset: number; rowPageSize: number; rowSearchQuery: string; rowFilter?: RequestBatchRowFilter }) => {
      const page = context.pageByBatchId[event.batchId]
      if (!page || page.rowOffset !== event.rowOffset || page.rowPageSize !== event.rowPageSize || page.rowSearchQuery !== event.rowSearchQuery || page.rowFilter !== (event.rowFilter ?? null)) {
        return context
      }
      return {
        ...context,
        pageByBatchId: { ...context.pageByBatchId, [event.batchId]: { ...page, loading: false } },
      }
    },
    batchImported: (context, event: { batch: RequestBatchRecord }) => {
      const existing = context.batchesByRequestId[event.batch.requestId] ?? []
      const current = existing.find(batch => batch.id === event.batch.id)
      const shouldKeepCurrent =
        current &&
        ((event.batch.status === 'running' && current.status !== 'ready') || current.updatedAt > event.batch.updatedAt)
      const batch = shouldKeepCurrent ? current : event.batch
      return {
        ...context,
        batchesByRequestId: {
          ...context.batchesByRequestId,
          [event.batch.requestId]: [batch, ...existing.filter(candidate => candidate.id !== event.batch.id)],
        },
        selectedBatchIdByRequestId: {
          ...context.selectedBatchIdByRequestId,
          [event.batch.requestId]: event.batch.id,
        },
      }
    },
    batchDeleted: (context, event: { requestId: string; batchId: string }) => {
      const batches = (context.batchesByRequestId[event.requestId] ?? []).filter(batch => batch.id !== event.batchId)
      const nextPages = { ...context.pageByBatchId }
      delete nextPages[event.batchId]
      return {
        ...context,
        batchesByRequestId: { ...context.batchesByRequestId, [event.requestId]: batches },
        selectedBatchIdByRequestId: {
          ...context.selectedBatchIdByRequestId,
          [event.requestId]:
            context.selectedBatchIdByRequestId[event.requestId] === event.batchId
              ? (batches[0]?.id ?? null)
              : context.selectedBatchIdByRequestId[event.requestId],
        },
        pageByBatchId: nextPages,
      }
    },
    batchUpdated: (context, event: BatchUpdate) =>
      applyProgressUpdates(context, { batches: new Map([[event.batchId, event]]), rows: new Map() }),
    rowUpdated: (context, event: RowUpdate) =>
      applyProgressUpdates(context, { batches: new Map(), rows: new Map([[event.batchId, new Map([[event.rowId, event]])]]) }),
  },
})

let persistedRowPageSize = requestBatchStore.getSnapshot().context.rowPageSize
requestBatchStore.subscribe(state => {
  if (state.context.rowPageSize === persistedRowPageSize) return
  try {
    localStorage.setItem(ROW_PAGE_SIZE_STORAGE_KEY, String(state.context.rowPageSize))
    persistedRowPageSize = state.context.rowPageSize
  } catch {
    return
  }
})

let persistedRowDetailView = requestBatchStore.getSnapshot().context.rowDetailView
requestBatchStore.subscribe(state => {
  if (state.context.rowDetailView === persistedRowDetailView) return
  try {
    localStorage.setItem(ROW_DETAIL_VIEW_STORAGE_KEY, state.context.rowDetailView)
    persistedRowDetailView = state.context.rowDetailView
  } catch {
    return
  }
})

const LIVE_UPDATE_THROTTLE_MS = 300
let pendingProgress: ProgressUpdates = { batches: new Map(), rows: new Map() }
let progressTimer: ReturnType<typeof setTimeout> | null = null

function scheduleProgressUpdate() {
  if (progressTimer !== null) return
  progressTimer = setTimeout(() => {
    progressTimer = null
    const updates = pendingProgress
    pendingProgress = { batches: new Map(), rows: new Map() }
    requestBatchStore.trigger.progressUpdated(updates)

    for (const update of updates.batches.values()) {
      if (update.status === 'running') continue
      const page = requestBatchStore.getSnapshot().context.pageByBatchId[update.batchId]
      if (page) void RequestBatchCoordinator.loadPage(update.batchId, page.rowSearchQuery, page.rowOffset)
    }
  }, LIVE_UPDATE_THROTTLE_MS)
}

export const RequestBatchCoordinator = {
  queueBatchUpdate(update: BatchUpdate) {
    pendingProgress.batches.set(update.batchId, update)
    scheduleProgressUpdate()
  },
  queueRowUpdate(update: RowUpdate) {
    let rows = pendingProgress.rows.get(update.batchId)
    if (!rows) {
      rows = new Map()
      pendingProgress.rows.set(update.batchId, rows)
    }
    rows.set(update.rowId, update)
    scheduleProgressUpdate()
  },
  setRowDetailView(view: RequestBatchRowDetailView) {
    requestBatchStore.trigger.rowDetailViewChanged({ view })
  },
  setRowPageSize(size: number) {
    if (!Number.isSafeInteger(size) || size <= 0) return
    requestBatchStore.trigger.rowPageSizeChanged({ size })
  },
  async loadBatches(requestId: string) {
    requestBatchStore.trigger.batchesLoading({ requestId })
    try {
      const batches: RequestBatchRecord[] = []
      let offset = 0
      while (true) {
        const result = await getWindowElectron().listRequestBatches({
          requestId,
          searchQuery: '',
          offset,
          limit: REQUEST_BATCH_LIST_PAGE_SIZE,
        })
        batches.push(...result.items)
        if (result.nextOffset === null) break
        offset = result.nextOffset
      }
      requestBatchStore.trigger.batchesLoaded({ requestId, batches })
      const selectedBatchId = requestBatchStore.getSnapshot().context.selectedBatchIdByRequestId[requestId]
      if (selectedBatchId) {
        const page = requestBatchStore.getSnapshot().context.pageByBatchId[selectedBatchId]
        await RequestBatchCoordinator.loadPage(selectedBatchId, page?.rowSearchQuery ?? '', page?.rowOffset ?? 0)
      }
    } catch (error) {
      requestBatchStore.trigger.batchesLoadFailed({ requestId })
      toast.show({ severity: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  },

  async selectBatch(requestId: string, batchId: string) {
    requestBatchStore.trigger.batchSelected({ requestId, batchId })
    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batchId]
    await RequestBatchCoordinator.loadPage(batchId, page?.rowSearchQuery ?? '', page?.rowOffset ?? 0)
  },

  async importBatch(input: ImportRequestBatchFileInput) {
    const result = await getWindowElectron().importRequestBatchFile(input)
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }
    requestBatchStore.trigger.batchImported({ batch: result.data })
    await RequestBatchCoordinator.loadPage(result.data.id, '', 0)
    return result.data
  },

  async loadPage(batchId: string, rowSearchQuery: string, rowOffset: number, pageSize?: number, filter?: RequestBatchRowFilter) {
    const context = requestBatchStore.getSnapshot().context
    const rowPageSize = pageSize ?? context.rowPageSize
    const rowFilter = filter === undefined ? context.pageByBatchId[batchId]?.rowFilter ?? null : filter
    if (context.pageByBatchId[batchId]?.rowPageSize !== rowPageSize) rowOffset = 0
    const batch = findBatch(context, batchId) ?? context.pageByBatchId[batchId]?.batch
    if (!batch) return
    requestBatchStore.trigger.pageLoading({ batch, rowOffset, rowPageSize, rowSearchQuery, rowFilter })
    try {
      const result = await getWindowElectron().getRequestBatch({
        id: batchId,
        rowSearchQuery,
        rowOffset,
        rowLimit: rowPageSize,
        rowStatus: rowFilter === 'all' || rowFilter === null ? undefined : rowFilter,
      })
      const pendingPage = requestBatchStore.getSnapshot().context.pageByBatchId[batchId]
      if (!pendingPage || pendingPage.rowOffset !== rowOffset || pendingPage.rowPageSize !== rowPageSize || pendingPage.rowSearchQuery !== rowSearchQuery || pendingPage.rowFilter !== rowFilter) return
      if (!result.success) {
        toast.show(result)
        requestBatchStore.trigger.pageLoadFailed({ batchId, rowOffset, rowPageSize, rowSearchQuery, rowFilter })
        return
      }
      const lastRowOffset = Math.max(
        0,
        Math.floor((result.data.totalRowCount - 1) / rowPageSize) * rowPageSize
      )
      if (rowOffset > lastRowOffset) {
        await RequestBatchCoordinator.loadPage(batchId, rowSearchQuery, lastRowOffset, rowPageSize, rowFilter)
        return
      }
      requestBatchStore.trigger.pageLoaded({
        batch: result.data.batch,
        rows: result.data.rows,
        rowOffset,
        rowPageSize,
        nextRowOffset: result.data.nextRowOffset,
        totalRowCount: result.data.totalRowCount,
        rowSearchQuery,
        rowFilter,
      })
    } catch (error) {
      requestBatchStore.trigger.pageLoadFailed({ batchId, rowOffset, rowPageSize, rowSearchQuery, rowFilter })
      toast.show({ severity: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  },

  async startBatch(batchId: string, concurrency: number, request: SendRequestInput) {
    const result = await getWindowElectron().startRequestBatch({ batchId, concurrency, request })
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }
    requestBatchStore.trigger.batchImported({ batch: result.data.batch })
    await RequestBatchCoordinator.loadPage(result.data.batch.id, '', 0)
  },

  async runRow(batchId: string, rowId: string, request: SendRequestInput) {
    const page = requestBatchStore.getSnapshot().context.pageByBatchId[batchId]
    const result = await getWindowElectron().runRequestBatchRow({ batchId, rowId, request })
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }
    requestBatchStore.trigger.batchImported({ batch: result.data.batch })
    await RequestBatchCoordinator.loadPage(batchId, page?.rowSearchQuery ?? '', page?.rowOffset ?? 0)
  },

  async cancelBatch(batchId: string) {
    const result = await getWindowElectron().cancelRequestBatch({ batchId })
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }
  },

  async updateConcurrency(batchId: string, concurrency: number) {
    const result = await getWindowElectron().updateRequestBatchConcurrency({ batchId, concurrency })
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }
    requestBatchStore.trigger.concurrencyUpdated({ batchId, concurrency })
  },

  async deleteBatch(requestId: string, batchId: string) {
    const batch = findBatch(requestBatchStore.getSnapshot().context, batchId)
    if (batch?.status === 'running') return
    const result = await getWindowElectron().deleteRequestBatch({ id: batchId })
    if (!result.success) {
      toast.show(result)
      return
    }
    requestBatchStore.trigger.batchDeleted({ requestId, batchId })
    const selected = requestBatchStore.getSnapshot().context.selectedBatchIdByRequestId[requestId]
    if (selected) await RequestBatchCoordinator.loadPage(selected, '', 0)
  },
}

function applyProgressUpdates(context: RequestBatchContext, updates: ProgressUpdates): RequestBatchContext {
  const updatedAt = Date.now()
  const updateBatch = (batch: RequestBatchRecord) => {
    const update = updates.batches.get(batch.id)
    return update ? {
      ...batch,
      status: update.status,
      summary: update.summary,
      startedAt: update.startedAt,
      completedAt: update.completedAt,
      updatedAt,
    } : batch
  }
  const batchesByRequestId = { ...context.batchesByRequestId }
  const pageByBatchId = { ...context.pageByBatchId }
  let changed = false

  for (const [requestId, batches] of Object.entries(context.batchesByRequestId)) {
    if (!batches.some(batch => updates.batches.has(batch.id))) continue
    batchesByRequestId[requestId] = batches.map(updateBatch)
    changed = true
  }
  for (const batchId of new Set([...updates.batches.keys(), ...updates.rows.keys()])) {
    const page = context.pageByBatchId[batchId]
    if (!page) continue
    const batch = updateBatch(page.batch)
    const rowUpdates = updates.rows.get(batchId)
    let rowsChanged = false
    const rows = rowUpdates ? page.rows.map(row => {
      const update = rowUpdates.get(row.id)
      if (!update) return row
      rowsChanged = true
      return {
        ...row,
        status: update.status,
        historyId: update.historyId,
        errorMessage: update.errorMessage,
        startedAt: update.startedAt,
        completedAt: update.completedAt,
        updatedAt,
      }
    }) : page.rows
    if (batch === page.batch && !rowsChanged) continue
    pageByBatchId[batchId] = { ...page, batch, rows: rowsChanged ? rows : page.rows }
    changed = true
  }
  return changed ? { ...context, batchesByRequestId, pageByBatchId } : context
}

function getSelectedBatchId(context: RequestBatchContext, requestId: string, batches: RequestBatchRecord[]) {
  const selected = context.selectedBatchIdByRequestId[requestId]
  return selected && batches.some(batch => batch.id === selected) ? selected : (batches[0]?.id ?? null)
}

function findBatch(context: RequestBatchContext, batchId: string) {
  for (const batches of Object.values(context.batchesByRequestId)) {
    const batch = batches.find(candidate => candidate.id === batchId)
    if (batch) return batch
  }
  return undefined
}

function replaceBatch(context: RequestBatchContext, batch: RequestBatchRecord): RequestBatchContext {
  const page = context.pageByBatchId[batch.id]
  return {
    ...context,
    batchesByRequestId: {
      ...context.batchesByRequestId,
      [batch.requestId]: (context.batchesByRequestId[batch.requestId] ?? []).map(current =>
        current.id === batch.id ? batch : current
      ),
    },
    pageByBatchId: page ? { ...context.pageByBatchId, [batch.id]: { ...page, batch } } : context.pageByBatchId,
  }
}
