import { createStore } from '@xstate/store'
import { z } from 'zod'
import { errorResponseToMessage } from '@common/GenericError'
import type { RequestExecutionRecord, SendRequestResponse } from '@common/Requests'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import { getWindowElectron } from '@/getWindowElectron'
import { createAsyncStoragePersistence } from '@/utils/asyncStorage'
import type { RequestDetailsDraft } from './folderExplorerTypes'

const HISTORY_PAGE_SIZE = 20
const MAX_HISTORY_KEEP_LAST = 1000

const requestHistorySettingsSchema = z.object({
  keepLast: z.number().int().min(1).max(MAX_HISTORY_KEEP_LAST),
})

const requestHistorySettingsPersistence = createAsyncStoragePersistence(
  AsyncStorageKeys.requestHistorySettings,
  requestHistorySettingsSchema
)

type RequestExecutionContext = {
  history: RequestExecutionRecord[]
  historySearchQuery: string
  historyLoading: boolean
  historyLoadingMore: boolean
  historyLoaded: boolean
  historyNextOffset: number | null
  historyKeepLast: number
  responseByRequestId: Record<string, SendRequestResponse | null>
  errorByRequestId: Record<string, string | null>
}

const initialSettings = requestHistorySettingsPersistence.load({ keepLast: MAX_HISTORY_KEEP_LAST })

export const requestExecutionStore = createStore({
  context: {
    history: [],
    historySearchQuery: '',
    historyLoading: false,
    historyLoadingMore: false,
    historyLoaded: false,
    historyNextOffset: 0,
    historyKeepLast: normalizeKeepLast(initialSettings.keepLast),
    responseByRequestId: {},
    errorByRequestId: {},
  } as RequestExecutionContext,
  on: {
    requestSucceeded: (
      context,
      event: { requestId: string; requestName: string; requestDraft: RequestDetailsDraft; response: SendRequestResponse }
    ) => {
      const normalizedResponse = normalizeSendRequestResponse(event)

      return {
        ...context,
        responseByRequestId: {
          ...context.responseByRequestId,
          [event.requestId]: normalizedResponse,
        },
        errorByRequestId: {
          ...context.errorByRequestId,
          [event.requestId]: null,
        },
      }
    },
    requestFailed: (context, event: { requestId: string; error: string }) => ({
      ...context,
      errorByRequestId: {
        ...context.errorByRequestId,
        [event.requestId]: event.error,
      },
    }),
    historyLoadingStarted: (context, event: { append: boolean }) => ({
      ...context,
      historyLoading: event.append ? context.historyLoading : true,
      historyLoadingMore: event.append,
    }),
    historyLoaded: (context, event: { items: RequestExecutionRecord[]; nextOffset: number | null; append: boolean }) => ({
      ...context,
      history: event.append ? [...context.history, ...event.items] : event.items,
      historyLoading: false,
      historyLoadingMore: false,
      historyLoaded: true,
      historyNextOffset: event.nextOffset,
    }),
    historyLoadFailed: context => ({
      ...context,
      historyLoading: false,
      historyLoadingMore: false,
      historyLoaded: true,
    }),
    historySearchQueryChanged: (context, event: { searchQuery: string }) => ({
      ...context,
      historySearchQuery: event.searchQuery,
    }),
    historyKeepLastChanged: (context, event: { keepLast: number }) => ({
      ...context,
      historyKeepLast: normalizeKeepLast(event.keepLast),
    }),
    historyEntryDeleted: (context, event: { id: string }) => ({
      ...context,
      history: context.history.filter(entry => entry.id !== event.id),
    }),
  },
})

requestExecutionStore.subscribe(state => {
  requestHistorySettingsPersistence.save({ keepLast: state.context.historyKeepLast })
})

export namespace RequestExecutionCoordinator {
  export async function ensureHistoryLoaded() {
    const state = requestExecutionStore.getSnapshot().context
    if (state.historyLoaded || state.historyLoading) {
      return
    }

    await refreshHistory()
  }

  export async function refreshHistory() {
    await loadHistoryPage({ append: false })
  }

  export async function loadNextHistory() {
    const state = requestExecutionStore.getSnapshot().context
    if (state.historyLoading || state.historyLoadingMore || state.historyNextOffset === null) {
      return
    }

    await loadHistoryPage({ append: true })
  }

  export function setSearchQuery(searchQuery: string) {
    requestExecutionStore.trigger.historySearchQueryChanged({ searchQuery })
  }

  export function setKeepLast(keepLast: number) {
    requestExecutionStore.trigger.historyKeepLastChanged({ keepLast })
  }

  export async function deleteHistoryEntry(id: string) {
    const result = await getWindowElectron().deleteRequestHistoryEntry({ id })
    if (!result.success) {
      throw new Error(errorResponseToMessage(result.error))
    }

    requestExecutionStore.trigger.historyEntryDeleted({ id })
  }

  export async function trimHistory() {
    const keepLast = requestExecutionStore.getSnapshot().context.historyKeepLast
    const result = await getWindowElectron().trimRequestHistory({ keepLast })
    if (!result.success) {
      throw new Error(errorResponseToMessage(result.error))
    }

    await refreshHistory()
  }
}

async function loadHistoryPage({ append }: { append: boolean }) {
  const state = requestExecutionStore.getSnapshot().context
  requestExecutionStore.trigger.historyLoadingStarted({ append })

  try {
    const result = await getWindowElectron().listRequestHistory({
      searchQuery: state.historySearchQuery,
      offset: append ? (state.historyNextOffset ?? state.history.length) : 0,
      limit: HISTORY_PAGE_SIZE,
    })

    requestExecutionStore.trigger.historyLoaded({
      items: result.items.filter(isRequestExecutionRecord),
      nextOffset: result.nextOffset,
      append,
    })
  } catch {
    requestExecutionStore.trigger.historyLoadFailed()
  }
}

function isRequestExecutionRecord(value: RequestExecutionRecord | null | undefined): value is RequestExecutionRecord {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      value.request &&
      typeof value.request.url === 'string' &&
      Array.isArray(value.consoleEntries) &&
      Array.isArray(value.scriptErrors)
  )
}

function normalizeExecutionRecord(event: {
  requestId: string
  requestName: string
  requestDraft: RequestDetailsDraft
  response: SendRequestResponse
}): RequestExecutionRecord | null {
  if (isRequestExecutionRecord(event.response.execution)) {
    return event.response.execution
  }

  return {
    id: crypto.randomUUID(),
    requestId: event.requestId,
    requestName: event.requestName,
    request: {
      requestId: event.requestId,
      requestName: event.requestName,
      method: event.requestDraft.method,
      url: event.requestDraft.url,
      headers: event.requestDraft.headers,
      body: event.requestDraft.body,
      variables: {},
      bodyType: event.requestDraft.bodyType,
      rawType: event.requestDraft.rawType,
      sentAt: Date.now(),
    },
    response: {
      status: event.response.status,
      statusText: event.response.statusText,
      headers: event.response.headers,
      body: event.response.body,
      bodyOmitted: false,
      durationMs: event.response.durationMs,
      receivedAt: Date.now(),
    },
    responseError: null,
    scriptErrors: event.response.scriptErrors ?? [],
    consoleEntries: event.response.consoleEntries ?? [],
  }
}

function normalizeSendRequestResponse(event: {
  requestId: string
  requestName: string
  requestDraft: RequestDetailsDraft
  response: SendRequestResponse
}): SendRequestResponse {
  const execution = normalizeExecutionRecord(event)

  return {
    ...event.response,
    scriptErrors: event.response.scriptErrors ?? [],
    updatedEnvironments: event.response.updatedEnvironments ?? [],
    consoleEntries: event.response.consoleEntries ?? [],
    execution: execution ?? event.response.execution,
  }
}

function normalizeKeepLast(value: number) {
  if (!Number.isFinite(value)) {
    return MAX_HISTORY_KEEP_LAST
  }

  return Math.max(1, Math.min(MAX_HISTORY_KEEP_LAST, Math.trunc(value)))
}
