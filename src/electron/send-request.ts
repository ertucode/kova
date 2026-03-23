import { getAuthVariableSources } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { extractTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import { isSseContentType, parseSseBlock, stringifySseEvent } from '../common/Sse.js'
import type {
  CancelHttpRequestInput,
  ExecutedRequestSnapshot,
  HttpSseStreamState,
  ReceivedResponseSnapshot,
  RequestExecutionRecord,
  ScriptResponseBody,
  SendRequestInput,
  SendRequestResponse,
  SseEventRecord,
} from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { persistRequestHistory } from './db/request-history.js'
import { emitGenericEvent } from './generic-events.js'
import { prepareHttpRequest, type PreparedHttpRequest } from './http-request-runtime.js'

const activeHttpRequests = new Map<string, { executionId: string; abortController: AbortController }>()

export async function cancelHttpRequest(input: CancelHttpRequestInput): Promise<GenericResult<void>> {
  activeHttpRequests.get(input.requestId)?.abortController.abort()
  return Result.Success(undefined)
}

export async function sendRequest(input: SendRequestInput): Promise<GenericResult<SendRequestResponse>> {
  const executionId = crypto.randomUUID()
  const abortController = new AbortController()

  try {
    const preparedRequest = await prepareHttpRequest(input)
    if (!preparedRequest.success) {
      return preparedRequest
    }

    emitGenericEvent({ type: 'http-sse-stream-cleared', requestId: input.requestId })
    activeHttpRequests.set(input.requestId, { executionId, abortController })

    const { headers, postRequestScriptSources, requestBody, requestName, runtime, url, variables } = preparedRequest.data
    const sentAt = Date.now()
    const executedRequest = buildExecutedRequestSnapshot({
      requestId: input.requestId,
      requestName,
      request: runtime.request,
      url,
      headers,
      body: requestBody.preview,
      variables,
      sentAt,
    })
    const startedAt = Date.now()
    const response = await fetch(url, {
      method: runtime.request.method,
      headers,
      body: requestBody.body,
      signal: abortController.signal,
    })

    const responseHeaders = Array.from(response.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')

    if (isSseContentType(getResponseContentType(responseHeaders))) {
      return await consumeSseResponse({
        input,
        response,
        responseHeaders,
        requestName,
        runtime,
        postRequestScriptSources,
        executedRequest,
        executionId,
        sentAt,
        startedAt,
      })
    }

    const bodyText = await response.text()
    const durationMs = Date.now() - startedAt

    const scriptErrors = await runtime.runPostRequestScripts(postRequestScriptSources, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parseScriptResponseBody(bodyText, responseHeaders),
    })

    const updatedEnvironments = runtime.getUpdatedEnvironments()
    const responseSnapshot: ReceivedResponseSnapshot = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      bodyOmitted: false,
      durationMs,
      receivedAt: sentAt + durationMs,
    }

    if (updatedEnvironments.length > 0) {
      emitGenericEvent({
        type: 'environments-updated',
        environmentIds: updatedEnvironments.map(environment => environment.id),
      })
    }

    const execution: RequestExecutionRecord = {
      itemType: 'http',
      id: executionId,
      requestId: input.requestId,
      requestName,
      request: executedRequest,
      response: responseSnapshot,
      responseError: null,
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      consoleEntries: runtime.getConsoleEntries(),
    }

    let persistedExecution = execution
    if (input.saveToHistory) {
      try {
        persistedExecution = await persistRequestHistory({ execution, keepLast: input.historyKeepLast })
      } catch (historyError) {
        console.error('persistRequestHistory failed', historyError)
      }
    }

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      durationMs,
      requestScope: runtime.getRequestScopeValues(),
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      updatedEnvironments,
      consoleEntries: runtime.getConsoleEntries(),
      execution: persistedExecution,
    })
  } catch (error) {
    console.error('sendRequest failed', error)
    return GenericError.Message(isAbortError(error) ? 'Request cancelled' : formatRequestError(error))
  } finally {
    clearActiveHttpRequest(input.requestId, executionId)
  }
}

async function consumeSseResponse(input: {
  input: SendRequestInput
  response: Response
  responseHeaders: string
  requestName: string
  runtime: PreparedHttpRequest['runtime']
  postRequestScriptSources: PreparedHttpRequest['postRequestScriptSources']
  executedRequest: ExecutedRequestSnapshot
  executionId: string
  sentAt: number
  startedAt: number
}): Promise<GenericResult<SendRequestResponse>> {
  const { response, responseHeaders, requestName, runtime, postRequestScriptSources, executedRequest, executionId, sentAt } = input
  const reader = response.body?.getReader()
  let bodyText = ''
  let buffer = ''
  let streamState: HttpSseStreamState = {
    executionId,
    requestId: input.input.requestId,
    requestName,
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: '',
    durationMs: Date.now() - input.startedAt,
    state: 'streaming',
    responseError: null,
    events: [],
  }

  emitHttpSseStreamUpdated(streamState)

  try {
    if (reader) {
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        ;({ buffer, bodyText, streamState } = appendBufferedSseEvents({
          buffer,
          bodyText,
          streamState,
          startedAt: input.startedAt,
        }))
      }

      buffer += decoder.decode()
    }

    ;({ buffer, bodyText, streamState } = appendBufferedSseEvents({
      buffer,
      bodyText,
      streamState,
      startedAt: input.startedAt,
      flush: true,
    }))

    const durationMs = Date.now() - input.startedAt
    const scriptErrors = await runtime.runPostRequestScripts(postRequestScriptSources, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parseScriptResponseBody(bodyText, responseHeaders),
    })
    const updatedEnvironments = runtime.getUpdatedEnvironments()

    if (updatedEnvironments.length > 0) {
      emitGenericEvent({
        type: 'environments-updated',
        environmentIds: updatedEnvironments.map(environment => environment.id),
      })
    }

    const responseSnapshot: ReceivedResponseSnapshot = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      bodyOmitted: false,
      durationMs,
      receivedAt: sentAt + durationMs,
    }

    const execution: RequestExecutionRecord = {
      itemType: 'http',
      id: executionId,
      requestId: input.input.requestId,
      requestName,
      request: executedRequest,
      response: responseSnapshot,
      responseError: null,
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      consoleEntries: runtime.getConsoleEntries(),
    }

    let persistedExecution = execution
    if (input.input.saveToHistory) {
      try {
        persistedExecution = await persistRequestHistory({ execution, keepLast: input.input.historyKeepLast })
      } catch (historyError) {
        console.error('persistRequestHistory failed', historyError)
      }
    }

    streamState = {
      ...streamState,
      body: bodyText,
      durationMs,
      state: 'completed',
    }
    emitHttpSseStreamUpdated(streamState)

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      durationMs,
      requestScope: runtime.getRequestScopeValues(),
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      updatedEnvironments,
      consoleEntries: runtime.getConsoleEntries(),
      execution: persistedExecution,
    })
  } catch (error) {
    if (isAbortError(error)) {
      emitHttpSseStreamUpdated({
        ...streamState,
        body: bodyText,
        durationMs: Date.now() - input.startedAt,
        state: 'cancelled',
        responseError: 'Request cancelled',
      })
      return GenericError.Message('Request cancelled')
    }

    const errorMessage = formatRequestError(error)
    emitHttpSseStreamUpdated({
      ...streamState,
      body: bodyText,
      durationMs: Date.now() - input.startedAt,
      state: 'failed',
      responseError: errorMessage,
    })
    return GenericError.Message(errorMessage)
  }
}

function appendBufferedSseEvents(input: {
  buffer: string
  bodyText: string
  streamState: HttpSseStreamState
  startedAt: number
  flush?: boolean
}) {
  let buffer = normalizeSseText(input.buffer)
  let bodyText = input.bodyText
  let streamState = input.streamState

  while (true) {
    const separatorIndex = buffer.indexOf('\n\n')
    if (separatorIndex === -1) {
      break
    }

    const block = buffer.slice(0, separatorIndex)
    buffer = buffer.slice(separatorIndex + 2)
    ;({ bodyText, streamState } = appendSseBlock({ block, bodyText, streamState, startedAt: input.startedAt }))
  }

  if (input.flush && buffer.trim()) {
    ;({ bodyText, streamState } = appendSseBlock({ block: buffer, bodyText, streamState, startedAt: input.startedAt }))
    buffer = ''
  }

  return { buffer, bodyText, streamState }
}

function appendSseBlock(input: { block: string; bodyText: string; streamState: HttpSseStreamState; startedAt: number }) {
  const parsedEvent = parseSseBlock(input.block)
  if (!parsedEvent) {
    return { bodyText: input.bodyText, streamState: input.streamState }
  }

  const nextEvent: SseEventRecord = {
    ...parsedEvent,
    timestamp: Date.now(),
  }
  const nextBodyText = `${input.bodyText}${stringifySseEvent(nextEvent)}`
  const nextStreamState = {
    ...input.streamState,
    body: nextBodyText,
    durationMs: Date.now() - input.startedAt,
    events: [...input.streamState.events, nextEvent],
  }

  emitHttpSseStreamUpdated(nextStreamState)

  return {
    bodyText: nextBodyText,
    streamState: nextStreamState,
  }
}

function emitHttpSseStreamUpdated(stream: HttpSseStreamState) {
  emitGenericEvent({ type: 'http-sse-stream-updated', stream })
}

function normalizeSseText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function clearActiveHttpRequest(requestId: string, executionId: string) {
  const activeRequest = activeHttpRequests.get(requestId)
  if (activeRequest?.executionId === executionId) {
    activeHttpRequests.delete(requestId)
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function buildExecutedRequestSnapshot(input: {
  requestId: string
  requestName: string
  request: Pick<SendRequestInput, 'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType'>
  url: string
  headers: Headers
  body: string
  variables: Record<string, string>
  sentAt: number
}): ExecutedRequestSnapshot {
  return {
    requestId: input.requestId,
    requestName: input.requestName,
    method: input.request.method,
    url: input.url,
    headers: Array.from(input.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
    body: input.body,
    variables: collectUsedVariables(input.request, input.variables),
    bodyType: input.request.bodyType,
    rawType: input.request.rawType,
    sentAt: input.sentAt,
  }
}

function collectUsedVariables(
  input: Pick<SendRequestInput, 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType'>,
  variables: Record<string, string>
) {
  const variableNames = new Set<string>()

  for (const variableName of extractTemplateVariables(input.url)) {
    variableNames.add(variableName)
  }

  for (const row of parseKeyValueRows(input.pathParams)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of extractTemplateVariables(row.value)) {
      variableNames.add(variableName)
    }
  }

  for (const row of parseKeyValueRows(input.searchParams)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of extractTemplateVariables(row.key)) {
      variableNames.add(variableName)
    }

    for (const variableName of extractTemplateVariables(row.value)) {
      variableNames.add(variableName)
    }
  }

  for (const source of getAuthVariableSources(input.auth)) {
    for (const variableName of extractTemplateVariables(source)) {
      variableNames.add(variableName)
    }
  }

  for (const row of parseKeyValueRows(input.headers)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of extractTemplateVariables(row.key)) {
      variableNames.add(variableName)
    }

    for (const variableName of extractTemplateVariables(row.value)) {
      variableNames.add(variableName)
    }
  }

  if (input.bodyType === 'raw') {
    for (const variableName of extractTemplateVariables(input.body)) {
      variableNames.add(variableName)
    }
  }

  if (input.bodyType === 'form-data' || input.bodyType === 'x-www-form-urlencoded') {
    for (const row of parseKeyValueRows(input.body)) {
      if (!row.enabled) {
        continue
      }

      for (const variableName of extractTemplateVariables(row.key)) {
        variableNames.add(variableName)
      }

      for (const variableName of extractTemplateVariables(row.value)) {
        variableNames.add(variableName)
      }
    }
  }

  return Array.from(variableNames)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, string>>((result, variableName) => {
      const value = variables[variableName]
      if (value !== undefined) {
        result[variableName] = value
      }
      return result
    }, {})
}

function parseScriptResponseBody(body: string, headers: string): ScriptResponseBody {
  const contentType = getResponseContentType(headers)?.toLowerCase() ?? ''
  const shouldParseJson = contentType.includes('json') || /^[\[{]/.test(body.trim())

  if (!shouldParseJson) {
    return { type: 'text', data: body }
  }

  try {
    return {
      type: 'json',
      data: JSON.parse(body),
    }
  } catch {
    return { type: 'text', data: body }
  }
}

function getResponseContentType(headers: string) {
  return (
    headers
      .split('\n')
      .find(line => line.toLowerCase().startsWith('content-type:'))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? null
  )
}

function formatRequestError(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const messages = new Set<string>()
  collectErrorMessages(error, messages)

  return Array.from(messages).join('\n') || 'Unknown request error'
}

function collectErrorMessages(error: Error, messages: Set<string>) {
  if (error.message.trim()) {
    messages.add(error.message.trim())
  }

  const cause = 'cause' in error ? error.cause : undefined
  if (cause instanceof Error) {
    collectErrorMessages(cause, messages)
    return
  }

  if (typeof cause === 'string' && cause.trim()) {
    messages.add(cause.trim())
  }
}
