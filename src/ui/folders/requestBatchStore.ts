import { createStore } from '@xstate/store'
import type { GenericEvent } from '@common/GenericEvent'
import type { ImportRequestBatchFileInput, RequestBatchRecord, RequestBatchRowRecord } from '@common/RequestBatches'
import type { SendRequestInput } from '@common/Requests'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

export const REQUEST_BATCH_ROW_PAGE_SIZE = 50
const REQUEST_BATCH_LIST_PAGE_SIZE = 100

export type RequestBatchPage = {
  batch: RequestBatchRecord
  rows: RequestBatchRowRecord[]
  rowOffset: number
  nextRowOffset: number | null
  totalRowCount: number
  rowSearchQuery: string
  loading: boolean
}

type RequestBatchContext = {
  batchesByRequestId: Record<string, RequestBatchRecord[]>
  loadingByRequestId: Record<string, boolean>
  selectedBatchIdByRequestId: Record<string, string | null>
  pageByBatchId: Record<string, RequestBatchPage>
}

export const requestBatchStore = createStore({
  context: {
    batchesByRequestId: {},
    loadingByRequestId: {},
    selectedBatchIdByRequestId: {},
    pageByBatchId: {},
  } as RequestBatchContext,
  on: {
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
    pageLoading: (context, event: { batch: RequestBatchRecord; rowOffset: number; rowSearchQuery: string }) => ({
      ...context,
      pageByBatchId: {
        ...context.pageByBatchId,
        [event.batch.id]: {
          batch: event.batch,
          rows: context.pageByBatchId[event.batch.id]?.rows ?? [],
          rowOffset: event.rowOffset,
          nextRowOffset: null,
          totalRowCount: context.pageByBatchId[event.batch.id]?.totalRowCount ?? event.batch.rowCount,
          rowSearchQuery: event.rowSearchQuery,
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
        nextRowOffset: number | null
        totalRowCount: number
        rowSearchQuery: string
      }
    ) => {
      const pendingPage = context.pageByBatchId[event.batch.id]
      if (
        !pendingPage ||
        pendingPage.rowOffset !== event.rowOffset ||
        pendingPage.rowSearchQuery !== event.rowSearchQuery
      ) {
        return context
      }
      return {
        ...replaceBatch(context, event.batch),
        pageByBatchId: {
          ...context.pageByBatchId,
          [event.batch.id]: { ...event, loading: false },
        },
      }
    },
    pageLoadFailed: (context, event: { batchId: string; rowOffset: number; rowSearchQuery: string }) => {
      const page = context.pageByBatchId[event.batchId]
      if (!page || page.rowOffset !== event.rowOffset || page.rowSearchQuery !== event.rowSearchQuery) {
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
    batchUpdated: (context, event: Omit<Extract<GenericEvent, { type: 'request-batch-updated' }>, 'type'>) => {
      const current = findBatch(context, event.batchId)
      if (!current) return context
      return replaceBatch(context, {
        ...current,
        status: event.status,
        summary: event.summary,
        startedAt: event.startedAt,
        completedAt: event.completedAt,
        updatedAt: Date.now(),
      })
    },
    rowUpdated: (context, event: Omit<Extract<GenericEvent, { type: 'request-batch-row-updated' }>, 'type'>) => {
      const page = context.pageByBatchId[event.batchId]
      if (!page || !page.rows.some(row => row.id === event.rowId)) return context
      return {
        ...context,
        pageByBatchId: {
          ...context.pageByBatchId,
          [event.batchId]: {
            ...page,
            rows: page.rows.map(row =>
              row.id === event.rowId
                ? {
                    ...row,
                    status: event.status,
                    historyId: event.historyId,
                    startedAt: event.startedAt,
                    completedAt: event.completedAt,
                    updatedAt: Date.now(),
                  }
                : row
            ),
          },
        },
      }
    },
  },
})

export const RequestBatchCoordinator = {
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

  async loadPage(batchId: string, rowSearchQuery: string, rowOffset: number) {
    const context = requestBatchStore.getSnapshot().context
    const batch = findBatch(context, batchId) ?? context.pageByBatchId[batchId]?.batch
    if (!batch) return
    requestBatchStore.trigger.pageLoading({ batch, rowOffset, rowSearchQuery })
    try {
      const result = await getWindowElectron().getRequestBatch({
        id: batchId,
        rowSearchQuery,
        rowOffset,
        rowLimit: REQUEST_BATCH_ROW_PAGE_SIZE,
      })
      if (!result.success) {
        toast.show(result)
        requestBatchStore.trigger.pageLoadFailed({ batchId, rowOffset, rowSearchQuery })
        return
      }
      const lastRowOffset = Math.max(
        0,
        Math.floor((result.data.totalRowCount - 1) / REQUEST_BATCH_ROW_PAGE_SIZE) * REQUEST_BATCH_ROW_PAGE_SIZE
      )
      if (rowOffset > lastRowOffset) {
        await RequestBatchCoordinator.loadPage(batchId, rowSearchQuery, lastRowOffset)
        return
      }
      requestBatchStore.trigger.pageLoaded({
        batch: result.data.batch,
        rows: result.data.rows,
        rowOffset,
        nextRowOffset: result.data.nextRowOffset,
        totalRowCount: result.data.totalRowCount,
        rowSearchQuery,
      })
    } catch (error) {
      requestBatchStore.trigger.pageLoadFailed({ batchId, rowOffset, rowSearchQuery })
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
