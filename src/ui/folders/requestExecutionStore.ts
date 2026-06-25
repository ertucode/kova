import { createStore } from '@xstate/store'
import { z } from 'zod'
import { errorResponseToMessage } from '@common/GenericError'
import type {
  HttpSseStreamState,
  ListRecentHttpRequestUsageResponse,
  RequestScriptError,
  RequestExecutionRecord,
  RequestHistoryListItem,
  SendRequestResponse,
  WebSocketSessionRecord,
} from '@common/Requests'
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
  lastRequestSentAt: number | null
  history: RequestHistoryListItem[]
  historySearchQuery: string
  historyLoading: boolean
  historyLoadingMore: boolean
  historyLoaded: boolean
  historyNextOffset: number | null
  historyKeepLast: number
  recentHttpRequestUsageRequestIds: string[]
  recentHttpRequestUsageCountByRequestId: Record<string, number>
  recentHttpRequestUsageLoaded: boolean
  recentHttpRequestUsageLoading: boolean
  recentHttpRequestUsageVersion: number
  responseByRequestId: Record<string, SendRequestResponse | null>
  errorByRequestId: Record<string, string | null>
  scriptErrorsByRequestId: Record<string, RequestScriptError[]>
  httpSseByRequestId: Record<string, HttpSseStreamState | null>
  websocketSessionByRequestId: Record<string, WebSocketSessionRecord | null>
}

const initialSettings = requestHistorySettingsPersistence.load({ keepLast: MAX_HISTORY_KEEP_LAST })

export const requestExecutionStore = createStore({
  context: {
    history: [],
    lastRequestSentAt: null,
    historySearchQuery: '',
    historyLoading: false,
    historyLoadingMore: false,
    historyLoaded: false,
    historyNextOffset: 0,
    historyKeepLast: normalizeKeepLast(initialSettings.keepLast),
    recentHttpRequestUsageRequestIds: [],
    recentHttpRequestUsageCountByRequestId: {},
    recentHttpRequestUsageLoaded: false,
    recentHttpRequestUsageLoading: false,
    recentHttpRequestUsageVersion: 0,
    responseByRequestId: {},
    errorByRequestId: {},
    scriptErrorsByRequestId: {},
    httpSseByRequestId: {},
    websocketSessionByRequestId: {},
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
        scriptErrorsByRequestId: {
          ...context.scriptErrorsByRequestId,
          [event.requestId]: normalizedResponse.scriptErrors ?? [],
        },
      }
    },
    requestStarted: (context, event: { requestId: string; sentAt: number }) => ({
      ...context,
      lastRequestSentAt: event.sentAt,
      errorByRequestId: {
        ...context.errorByRequestId,
        [event.requestId]: null,
      },
      scriptErrorsByRequestId: {
        ...context.scriptErrorsByRequestId,
        [event.requestId]: [],
      },
    }),
    requestFailed: (context, event: { requestId: string; error: string; scriptErrors?: RequestScriptError[] }) => ({
      ...context,
      errorByRequestId: {
        ...context.errorByRequestId,
        [event.requestId]: event.error,
      },
      scriptErrorsByRequestId: {
        ...context.scriptErrorsByRequestId,
        [event.requestId]: normalizeScriptErrors(event.scriptErrors ?? []),
      },
    }),
    httpSseStreamUpdated: (context, event: { stream: HttpSseStreamState }) => ({
      ...context,
      httpSseByRequestId: {
        ...context.httpSseByRequestId,
        [event.stream.requestId]: event.stream,
      },
      errorByRequestId: {
        ...context.errorByRequestId,
        [event.stream.requestId]: event.stream.responseError,
      },
    }),
    httpSseStreamCleared: (context, event: { requestId: string }) => ({
      ...context,
      httpSseByRequestId: {
        ...context.httpSseByRequestId,
        [event.requestId]: null,
      },
    }),
    historyLoadingStarted: (context, event: { append: boolean }) => ({
      ...context,
      historyLoading: event.append ? context.historyLoading : true,
      historyLoadingMore: event.append,
    }),
    historyLoaded: (context, event: { items: RequestHistoryListItem[]; nextOffset: number | null; append: boolean }) => ({
      ...context,
      history: event.append
        ? [...context.history, ...event.items.map(normalizeHistoryItem)]
        : event.items.map(normalizeHistoryItem),
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
    recentHttpRequestUsageLoadingStarted: context => ({
      ...context,
      recentHttpRequestUsageLoading: true,
    }),
    recentHttpRequestUsageLoaded: (context, event: ListRecentHttpRequestUsageResponse) => ({
      ...context,
      recentHttpRequestUsageRequestIds: event.requestIds,
      recentHttpRequestUsageCountByRequestId: buildRecentHttpRequestUsageCountByRequestId(event.requestIds),
      recentHttpRequestUsageLoaded: true,
      recentHttpRequestUsageLoading: false,
      recentHttpRequestUsageVersion: context.recentHttpRequestUsageVersion + 1,
    }),
    recentHttpRequestUsageLoadFailed: context => ({
      ...context,
      recentHttpRequestUsageLoading: false,
    }),
    recentHttpRequestUsageRecorded: (context, event: { requestId: string }) => ({
      ...context,
      recentHttpRequestUsageRequestIds: [event.requestId, ...context.recentHttpRequestUsageRequestIds],
      recentHttpRequestUsageCountByRequestId: addRecentHttpRequestUsage(
        context.recentHttpRequestUsageCountByRequestId,
        event.requestId
      ),
      recentHttpRequestUsageVersion: context.recentHttpRequestUsageVersion + 1,
    }),
    recentHttpRequestUsageDeleted: (context, event: { requestId: string }) => {
      const nextRequestIds = removeRecentHttpRequestUsage(context.recentHttpRequestUsageRequestIds, event.requestId)

      if (nextRequestIds === context.recentHttpRequestUsageRequestIds) {
        return context
      }

      return {
        ...context,
        recentHttpRequestUsageRequestIds: nextRequestIds,
        recentHttpRequestUsageCountByRequestId: buildRecentHttpRequestUsageCountByRequestId(nextRequestIds),
        recentHttpRequestUsageVersion: context.recentHttpRequestUsageVersion + 1,
      }
    },
    recentHttpRequestUsageTrimmed: (context, event: { keepLast: number }) => {
      const nextRequestIds = context.recentHttpRequestUsageRequestIds.slice(0, event.keepLast)
      if (nextRequestIds.length === context.recentHttpRequestUsageRequestIds.length) {
        return context
      }

      return {
        ...context,
        recentHttpRequestUsageRequestIds: nextRequestIds,
        recentHttpRequestUsageCountByRequestId: buildRecentHttpRequestUsageCountByRequestId(nextRequestIds),
        recentHttpRequestUsageVersion: context.recentHttpRequestUsageVersion + 1,
      }
    },
    historyEntryDeleted: (context, event: { id: string; requestId?: string }) => {
      const nextRequestIds = event.requestId
        ? removeRecentHttpRequestUsage(context.recentHttpRequestUsageRequestIds, event.requestId)
        : context.recentHttpRequestUsageRequestIds

      return {
        ...context,
        history: context.history.filter(entry => entry.id !== event.id),
        recentHttpRequestUsageRequestIds: nextRequestIds,
        recentHttpRequestUsageCountByRequestId:
          nextRequestIds === context.recentHttpRequestUsageRequestIds
            ? context.recentHttpRequestUsageCountByRequestId
            : buildRecentHttpRequestUsageCountByRequestId(nextRequestIds),
        recentHttpRequestUsageVersion:
          nextRequestIds === context.recentHttpRequestUsageRequestIds
            ? context.recentHttpRequestUsageVersion
            : context.recentHttpRequestUsageVersion + 1,
      }
    },
    websocketSessionUpdated: (context, event: { session: WebSocketSessionRecord }) => ({
      ...context,
      websocketSessionByRequestId: {
        ...context.websocketSessionByRequestId,
        [event.session.requestId]: event.session,
      },
      errorByRequestId: {
        ...context.errorByRequestId,
        [event.session.requestId]: event.session.responseError,
      },
    }),
    websocketSessionCleared: (context, event: { requestId: string }) => ({
      ...context,
      websocketSessionByRequestId: {
        ...context.websocketSessionByRequestId,
        [event.requestId]: null,
      },
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

  export async function ensureRecentHttpRequestUsageLoaded() {
    const state = requestExecutionStore.getSnapshot().context
    if (state.recentHttpRequestUsageLoaded || state.recentHttpRequestUsageLoading) {
      return
    }

    requestExecutionStore.trigger.recentHttpRequestUsageLoadingStarted()

    try {
      const result = await getWindowElectron().listRecentHttpRequestUsage()
      requestExecutionStore.trigger.recentHttpRequestUsageLoaded(result)
    } catch {
      requestExecutionStore.trigger.recentHttpRequestUsageLoadFailed()
    }
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

  export async function deleteHistoryEntry(input: { id: string; itemType: 'http' | 'websocket'; requestId?: string }) {
    const result = await getWindowElectron().deleteRequestHistoryEntry({ id: input.id })
    if (!result.success) {
      throw new Error(errorResponseToMessage(result.error))
    }

    requestExecutionStore.trigger.historyEntryDeleted({
      id: input.id,
      requestId: input.itemType === 'http' ? input.requestId : undefined,
    })
  }

  export async function trimHistory() {
    const keepLast = requestExecutionStore.getSnapshot().context.historyKeepLast
    const result = await getWindowElectron().trimRequestHistory({ keepLast })
    if (!result.success) {
      throw new Error(errorResponseToMessage(result.error))
    }

    await refreshHistory()
    requestExecutionStore.trigger.recentHttpRequestUsageTrimmed({ keepLast })
  }

  export function recordRecentHttpRequestUsage(requestId: string) {
    requestExecutionStore.trigger.recentHttpRequestUsageRecorded({ requestId })
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
      items: result.items.filter(isRequestHistoryListItem),
      nextOffset: result.nextOffset,
      append,
    })
  } catch {
    requestExecutionStore.trigger.historyLoadFailed()
  }
}

function isRequestHistoryListItem(value: RequestHistoryListItem | null | undefined): value is RequestHistoryListItem {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      (value.itemType === 'http'
        ? value.request && typeof value.request.url === 'string' && Array.isArray(value.consoleEntries) && Array.isArray(value.scriptErrors)
        : typeof value.url === 'string' && Array.isArray(value.messages))
  )
}

function isRequestExecutionRecord(value: RequestHistoryListItem | RequestExecutionRecord | null | undefined): value is RequestExecutionRecord {
  return Boolean(value && value.itemType === 'http')
}

function normalizeHistoryItem(item: RequestHistoryListItem): RequestHistoryListItem {
  if (item.itemType !== 'http') {
    return item
  }

  return {
    ...item,
    scriptErrors: normalizeScriptErrors(item.scriptErrors ?? []),
  }
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
    itemType: 'http',
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
      graphqlQuery: event.requestDraft.graphqlQuery,
      graphqlVariables: event.requestDraft.graphqlVariables,
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
    scriptErrors: normalizeScriptErrors(event.response.scriptErrors ?? []),
    testRun: event.response.testRun ?? null,
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
    requestScope: event.response.requestScope ?? {},
    scriptErrors: normalizeScriptErrors(event.response.scriptErrors ?? []),
    testRun: event.response.testRun ?? null,
    updatedEnvironments: event.response.updatedEnvironments ?? [],
    consoleEntries: event.response.consoleEntries ?? [],
    execution: execution ?? event.response.execution,
  }
}

function buildRecentHttpRequestUsageCountByRequestId(requestIds: string[]) {
  return requestIds.reduce<Record<string, number>>((counts, requestId) => {
    counts[requestId] = (counts[requestId] ?? 0) + 1
    return counts
  }, {})
}

function addRecentHttpRequestUsage(counts: Record<string, number>, requestId: string) {
  return {
    ...counts,
    [requestId]: (counts[requestId] ?? 0) + 1,
  }
}

function removeRecentHttpRequestUsage(requestIds: string[], requestId: string) {
  const requestIndex = requestIds.indexOf(requestId)
  if (requestIndex < 0) {
    return requestIds
  }

  return requestIds.slice(0, requestIndex).concat(requestIds.slice(requestIndex + 1))
}

function normalizeScriptErrors(errors: RequestScriptError[]): RequestScriptError[] {
  return errors.map(error => {
    const line = typeof error.line === 'number' ? error.line : null
    const phase: RequestScriptError['phase'] =
      error.phase === 'pre-request' ? 'pre-request' : error.phase === 'test' ? 'test' : 'post-request'
    const compactLabel = error.compactLabel || buildCompactScriptErrorLabel(phase, line, typeof error.column === 'number' ? error.column : null)
    const compactMessage = error.compactMessage || error.message
    const detailedMessage = error.detailedMessage || error.message

    return {
      ...error,
      phase,
      compactLabel,
      compactMessage,
      detailedMessage,
      line,
      column: typeof error.column === 'number' ? error.column : null,
      sourceLine: typeof error.sourceLine === 'string' ? error.sourceLine : null,
    } satisfies RequestScriptError
  })
}

function buildCompactScriptErrorLabel(
  phase: RequestScriptError['phase'],
  line: number | null,
  column: number | null
) {
  const phaseLabel = phase === 'pre-request' ? 'Pre-request' : phase === 'test' ? 'Test' : 'Post-request'
  if (line === null) {
    return phaseLabel
  }

  return column === null ? `${phaseLabel}:${line}` : `${phaseLabel}:${line}:${column}`
}

function normalizeKeepLast(value: number) {
  if (!Number.isFinite(value)) {
    return MAX_HISTORY_KEEP_LAST
  }

  return Math.max(1, Math.min(MAX_HISTORY_KEEP_LAST, Math.trunc(value)))
}
