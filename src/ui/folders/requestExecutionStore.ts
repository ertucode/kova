import { createStore } from '@xstate/store'
import type { RequestExecutionRecord, SendRequestResponse } from '@common/Requests'
import type { RequestDetailsDraft } from './folderExplorerTypes'

type RequestExecutionContext = {
  history: RequestExecutionRecord[]
  responseByRequestId: Record<string, SendRequestResponse | null>
  errorByRequestId: Record<string, string | null>
}

export const requestExecutionStore = createStore({
  context: {
    history: [],
    responseByRequestId: {},
    errorByRequestId: {},
  } as RequestExecutionContext,
  on: {
    requestSucceeded: (
      context,
      event: { requestId: string; requestName: string; requestDraft: RequestDetailsDraft; response: SendRequestResponse }
    ) => {
      const normalizedResponse = normalizeSendRequestResponse(event)
      const nextExecution = normalizedResponse.execution
      const nextHistory = nextExecution ? [nextExecution, ...context.history] : context.history

      return {
        ...context,
        history: nextHistory.filter(isRequestExecutionRecord),
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
  },
})

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
