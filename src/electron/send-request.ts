import { getAuthVariableSources, getTokenRefreshRequestId } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { extractTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import type { ScriptCallRequestOverrides } from '../common/ScriptMakeRequest.js'
import type { ScriptClipboardBridge } from './script-clipboard.js'
import type { ScriptMakeRequestBridge } from './script-make-request.js'
import type { ScriptPromptBridge } from './script-prompt.js'
import type { ScriptToastOptions } from '../common/ScriptToast.js'
import { isSseContentType, parseSseBlock, stringifySseEvent } from '../common/Sse.js'
import type {
  CancelHttpRequestInput,
  ExecutedRequestSnapshot,
  FetchGraphqlSchemaInput,
  FetchGraphqlSchemaResponse,
  HttpSseStreamState,
  ReceivedResponseSnapshot,
  RequestExecutionRecord,
  RequestMethod,
  ScriptResponseBody,
  SendRequestInput,
  SendRequestResponse,
  SseEventRecord,
} from '../common/Requests.js'
import { buildClientSchema, getIntrospectionQuery, type IntrospectionQuery } from 'graphql'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { getSetCookieHeaderValuesFromEntries, storeResponseCookies } from './db/cookies.js'
import { getAppSettings } from './db/app-settings.js'
import { getFolderAncestorChain } from './db/folders.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { getRequest } from './db/requests.js'
import { persistRequestHistory } from './db/request-history.js'
import { emitGenericEvent } from './generic-events.js'
import { prepareHttpRequest, prepareHttpRequestBase, type PreparedHttpRequest } from './http-request-runtime.js'
import { getTlsDispatcher, resolveEffectiveTlsVerificationMode } from './tls-runtime.js'
import { DEFAULT_APP_SETTINGS_TLS_VERIFICATION_MODE } from '../common/AppSettings.js'
import type { AppSettingsTlsVerificationMode } from '../common/AppSettings.js'

const activeHttpRequests = new Map<string, { executionId: string; abortController: AbortController }>()
const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

type ScriptToastBridge = {
  show: (options: ScriptToastOptions) => void
  hide: (id: string) => void
}

export async function cancelHttpRequest(input: CancelHttpRequestInput): Promise<GenericResult<void>> {
  activeHttpRequests.get(input.requestId)?.abortController.abort()
  return Result.Success(undefined)
}

export async function fetchGraphqlSchema(
  input: FetchGraphqlSchemaInput,
  options?: {
    toast?: ScriptToastBridge
    prompt?: ScriptPromptBridge
    clipboard?: ScriptClipboardBridge
    makeRequest?: ScriptMakeRequestBridge
  }
): Promise<GenericResult<FetchGraphqlSchemaResponse>> {
  try {
    const preparedRequest = await prepareHttpRequestBase(
      {
        ...input,
        postRequestScript: '',
        testScript: '',
      },
      options
    )
    if (!preparedRequest.success) {
      return preparedRequest
    }

    const headers = new Headers(preparedRequest.data.headers)
    headers.set('accept', 'application/graphql-response+json, application/json')
    headers.set('content-type', 'application/json')
    const dispatcher = await resolveRequestTlsDispatcher(preparedRequest.data.url, input.requestId, input.tlsVerificationMode)

    const response = await fetch(preparedRequest.data.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: getIntrospectionQuery() }),
      dispatcher,
    } as RequestInit & { dispatcher?: unknown })
    const responseText = await response.text()
    const parsedPayload = parseGraphqlSchemaPayload(responseText)
    if (!parsedPayload.success) {
      return parsedPayload
    }

    if (!response.ok) {
      return GenericError.Http(
        response.status,
        parsedPayload.data.errors[0] ?? parsedPayload.data.errorMessage ?? (response.statusText || 'Failed to fetch GraphQL schema')
      )
    }

    if (parsedPayload.data.errors.length > 0) {
      return GenericError.Message(parsedPayload.data.errors.join('\n'))
    }

    if (!parsedPayload.data.data) {
      return GenericError.Message('GraphQL introspection response did not include schema data')
    }

    try {
      buildClientSchema(parsedPayload.data.data)
    } catch (error) {
      return GenericError.Message(getGraphqlSchemaValidationErrorMessage(error))
    }

    return Result.Success({ schema: JSON.stringify(parsedPayload.data.data) })
  } catch (error) {
    return GenericError.Message(isAbortError(error) ? 'GraphQL schema fetch cancelled' : formatRequestError(error))
  }
}

export async function sendRequest(
  input: SendRequestInput,
  options?: {
    toast?: ScriptToastBridge
    prompt?: ScriptPromptBridge
    clipboard?: ScriptClipboardBridge
    makeRequest?: ScriptMakeRequestBridge
  }
): Promise<GenericResult<SendRequestResponse>> {
  const executionId = crypto.randomUUID()
  const abortController = new AbortController()

  try {
    const preparedRequest = await prepareHttpRequest(input, {
      toast: options?.toast,
      prompt: options?.prompt,
      clipboard: options?.clipboard,
      makeRequest: options?.makeRequest,
    })
    if (!preparedRequest.success) {
      return preparedRequest
    }

    emitGenericEvent({ type: 'http-sse-stream-cleared', requestId: input.requestId })
    activeHttpRequests.set(input.requestId, { executionId, abortController })

    const overrideResult = applyScriptCallRequestOverrides({
      preparedRequest: preparedRequest.data,
      overrides: input.callRequestOverrides,
    })
    if (!overrideResult.success) {
      return overrideResult
    }

    const { headers, method, requestBody, url } = overrideResult.data
    const { postRequestScriptSources, testScriptSources, requestName, resolvedAuth, runtime, variables } = preparedRequest.data
    if (Object.hasOwn(input.callRequestOverrides ?? {}, 'method')) {
      runtime.request.method = method
    }
    if (Object.hasOwn(input.callRequestOverrides ?? {}, 'url')) {
      runtime.request.url = url
    }
    if (Object.hasOwn(input.callRequestOverrides ?? {}, 'headers')) {
      runtime.request.headers = serializeHeaderEntries(headers)
    }
    if (Object.hasOwn(input.callRequestOverrides ?? {}, 'body')) {
      runtime.request.body = requestBody.preview
    }
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
    const dispatcher = await resolveRequestTlsDispatcher(url, input.requestId, input.tlsVerificationMode)
    const response = await fetch(url, {
      method,
      headers,
      body: requestBody.body,
      dispatcher,
      signal: abortController.signal,
    } as RequestInit & { dispatcher?: unknown })
    const responseHeaderEntries = Array.from(response.headers.entries())
    let responseHeaders = serializeResponseHeaderEntries(responseHeaderEntries)

    console.info('[cookies] response received', {
      requestUrl: url,
      responseUrl: response.url,
      status: response.status,
      responseHeaders,
    })

    if (isSseContentType(getResponseContentType(responseHeaders))) {
      return await consumeSseResponse({
        input,
        options,
        response,
        responseHeaders,
        requestName,
        resolvedAuth,
        runtime,
        postRequestScriptSources,
        testScriptSources,
        executedRequest,
        executionId,
        sentAt,
        startedAt,
      })
    }

    const bodyText = await readResponseBody(response, responseHeaders)
    const durationMs = Date.now() - startedAt

    const scriptResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parseScriptResponseBody(bodyText, responseHeaders),
      rawBody: bodyText,
    }
    const postRequestResult = await runtime.runPostRequestScripts(postRequestScriptSources, scriptResponse)
    const scriptErrors = postRequestResult.scriptErrors
    responseHeaders = scriptResponse.headers

    const extractedSetCookieValues = getSetCookieHeaderValuesFromEntries(parseResponseHeaderEntries(responseHeaders))
    await storeResponseCookies({
      requestUrl: response.url || url,
      setCookieValues: extractedSetCookieValues,
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

    const authRetryRequested = postRequestResult.retryRequested
      ? false
      : await maybeRetryWithTokenRefresh({
        input,
        options,
        responseStatus: response.status,
        resolvedAuth,
      })
    const shouldRetryRequest = (postRequestResult.retryRequested || authRetryRequested) && shouldEmitRetryRequest(input.requestMetadata)
    const testResult = shouldRetryRequest ? { scriptErrors: [], registeredTests: 0, testRun: null } : await runtime.runTestScripts(testScriptSources, scriptResponse)

    const execution: RequestExecutionRecord = {
      itemType: 'http',
      id: executionId,
      folderRunId: input.folderRunId ?? null,
      folderRunFolderId: input.folderRunFolderId ?? null,
      requestId: input.requestId,
      requestName,
      request: executedRequest,
      response: responseSnapshot,
      responseError: null,
      scriptErrors,
      testRun: testResult.testRun,
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

    if (shouldRetryRequest) {
      emitRetryRequestEvent(input.requestId, input.requestMetadata)
    }

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      durationMs,
      requestScope: runtime.getRequestScopeValues(),
      scriptErrors,
      testRun: testResult.testRun,
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

export function applyScriptCallRequestOverrides(input: {
  preparedRequest: PreparedHttpRequest
  overrides: ScriptCallRequestOverrides | undefined
}): GenericResult<{
  method: RequestMethod
  url: string
  headers: Headers
  requestBody: PreparedHttpRequest['requestBody']
}> {
  let method = input.preparedRequest.method
  let url = input.preparedRequest.url
  let headers = cloneHeaders(input.preparedRequest.headers)
  let requestBody = input.preparedRequest.requestBody

  if (input.overrides === undefined) {
    return Result.Success({ method, url, headers, requestBody })
  }

  if (Object.hasOwn(input.overrides, 'method')) {
    const normalizedMethod = input.overrides.method?.trim().toUpperCase()
    if (!normalizedMethod || !REQUEST_METHODS.includes(normalizedMethod as RequestMethod)) {
      return GenericError.Message('callRequest override method is invalid')
    }

    method = normalizedMethod as RequestMethod
  }

  if (Object.hasOwn(input.overrides, 'url')) {
    const normalizedUrl = input.overrides.url?.trim()
    if (!normalizedUrl) {
      return GenericError.Message('callRequest override url is required')
    }

    try {
      url = new URL(normalizedUrl).toString()
    } catch {
      return GenericError.Message('callRequest override url is invalid')
    }
  }

  if (Object.hasOwn(input.overrides, 'headers')) {
    headers = new Headers()
    for (const [name, value] of Object.entries(input.overrides.headers ?? {})) {
      const normalizedName = name.trim()
      if (!normalizedName || value === undefined) {
        continue
      }

      headers.set(normalizedName, value)
    }
  }

  if (Object.hasOwn(input.overrides, 'body')) {
    requestBody = input.overrides.body === undefined ? { body: undefined, preview: '' } : { body: input.overrides.body, preview: input.overrides.body }
  }

  return Result.Success({ method, url, headers, requestBody })
}

async function consumeSseResponse(input: {
  input: SendRequestInput
  options:
    | {
        toast?: ScriptToastBridge
        prompt?: ScriptPromptBridge
        clipboard?: ScriptClipboardBridge
        makeRequest?: ScriptMakeRequestBridge
      }
    | undefined
  response: Response
  responseHeaders: string
  requestName: string
  resolvedAuth: PreparedHttpRequest['resolvedAuth']
  runtime: PreparedHttpRequest['runtime']
  postRequestScriptSources: PreparedHttpRequest['postRequestScriptSources']
  testScriptSources: PreparedHttpRequest['testScriptSources']
  executedRequest: ExecutedRequestSnapshot
  executionId: string
  sentAt: number
  startedAt: number
}): Promise<GenericResult<SendRequestResponse>> {
  const { response, requestName, runtime, postRequestScriptSources, testScriptSources, executedRequest, executionId, sentAt } = input
  let { responseHeaders } = input
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
    const scriptResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: parseScriptResponseBody(bodyText, responseHeaders),
      rawBody: bodyText,
    }
    const postRequestResult = await runtime.runPostRequestScripts(postRequestScriptSources, scriptResponse)
    const scriptErrors = postRequestResult.scriptErrors
    responseHeaders = scriptResponse.headers

    await storeResponseCookies({
      requestUrl: response.url || executedRequest.url,
      setCookieValues: getSetCookieHeaderValuesFromEntries(parseResponseHeaderEntries(responseHeaders)),
    })
    const updatedEnvironments = runtime.getUpdatedEnvironments()

    if (updatedEnvironments.length > 0) {
      emitGenericEvent({
        type: 'environments-updated',
        environmentIds: updatedEnvironments.map(environment => environment.id),
      })
    }

    const authRetryRequested = postRequestResult.retryRequested
      ? false
      : await maybeRetryWithTokenRefresh({
        input: input.input,
        options: input.options,
        responseStatus: response.status,
        resolvedAuth: input.resolvedAuth,
      })
    const shouldRetryRequest = (postRequestResult.retryRequested || authRetryRequested) && shouldEmitRetryRequest(input.input.requestMetadata)
    const testResult = shouldRetryRequest ? { scriptErrors: [], registeredTests: 0, testRun: null } : await runtime.runTestScripts(testScriptSources, scriptResponse)

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
      folderRunId: input.input.folderRunId ?? null,
      folderRunFolderId: input.input.folderRunFolderId ?? null,
      requestId: input.input.requestId,
      requestName,
      request: executedRequest,
      response: responseSnapshot,
      responseError: null,
      scriptErrors,
      testRun: testResult.testRun,
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

    if (shouldRetryRequest) {
      emitRetryRequestEvent(input.input.requestId, input.input.requestMetadata)
    }

    streamState = {
      ...streamState,
      body: bodyText,
      headers: responseHeaders,
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
      scriptErrors,
      testRun: testResult.testRun,
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
  request: Pick<SendRequestInput, 'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType' | 'graphqlQuery' | 'graphqlVariables'>
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
    graphqlQuery: input.request.graphqlQuery ?? '',
    graphqlVariables: input.request.graphqlVariables ?? '',
    sentAt: input.sentAt,
  }
}

function serializeResponseHeaderEntries(entries: Array<[string, string]>) {
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}

function serializeHeaderEntries(headers: Headers) {
  return Array.from(headers.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

function cloneHeaders(headers: Headers) {
  return new Headers(Array.from(headers.entries()))
}

function parseGraphqlSchemaPayload(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      data?: IntrospectionQuery
      errors?: Array<{ message?: unknown }>
    }

    return Result.Success({
      data: parsed.data,
      errors: Array.isArray(parsed.errors)
        ? parsed.errors
            .map(error => (typeof error?.message === 'string' ? error.message : null))
            .filter((message): message is string => message !== null)
        : [],
      errorMessage: undefined,
    })
  } catch {
    return GenericError.Message('GraphQL introspection response was not valid JSON')
  }
}

function getGraphqlSchemaValidationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return `Fetched GraphQL schema was invalid: ${error.message.trim()}`
  }

  return 'Fetched GraphQL schema was invalid'
}

function parseResponseHeaderEntries(headers: string) {
  return headers
    .split('\n')
    .map(line => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) {
        return null
      }

      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] satisfies [string, string]
    })
    .filter((entry): entry is [string, string] => entry !== null)
}

function collectUsedVariables(
  input: Pick<SendRequestInput, 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'graphqlQuery' | 'graphqlVariables'>,
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

  if (input.bodyType === 'graphql') {
    for (const variableName of extractTemplateVariables(input.graphqlQuery ?? '')) {
      variableNames.add(variableName)
    }

    for (const variableName of extractTemplateVariables(input.graphqlVariables ?? '')) {
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

async function readResponseBody(response: Response, headers: string) {
  const contentType = getResponseContentType(headers)?.toLowerCase() ?? ''

  if (!contentType.startsWith('image/') && !contentType.includes('application/pdf')) {
    return await response.text()
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  return buffer.toString('base64')
}

function shouldEmitRetryRequest(requestMetadata: SendRequestInput['requestMetadata']) {
  return requestMetadata?.sourceRuntime === 'request-editor'
}

async function maybeRetryWithTokenRefresh(input: {
  input: SendRequestInput
  options:
    | {
        toast?: ScriptToastBridge
        prompt?: ScriptPromptBridge
        clipboard?: ScriptClipboardBridge
        makeRequest?: ScriptMakeRequestBridge
      }
    | undefined
  responseStatus: number
  resolvedAuth: PreparedHttpRequest['resolvedAuth']
}) {
  const tokenRefreshRequestId = getTokenRefreshRequestId(input.resolvedAuth)
  if (
    input.input.requestMetadata?.sourceRuntime !== 'request-editor' ||
    (input.input.requestMetadata?.isRetry ?? false) ||
    input.responseStatus !== 401 && input.responseStatus !== 403 ||
    !tokenRefreshRequestId ||
    tokenRefreshRequestId === input.input.requestId
  ) {
    return false
  }

  const tokenRefreshRequestResult = await getRequest({ id: tokenRefreshRequestId })
  if (!tokenRefreshRequestResult.success) {
    return false
  }

  const tokenRefreshRequest = tokenRefreshRequestResult.data
  const refreshResult = await sendRequest(
    {
      requestId: tokenRefreshRequest.id,
      method: tokenRefreshRequest.method,
      url: tokenRefreshRequest.url,
      pathParams: tokenRefreshRequest.pathParams,
      searchParams: tokenRefreshRequest.searchParams,
      auth: tokenRefreshRequest.auth,
      preRequestScript: tokenRefreshRequest.preRequestScript,
      postRequestScript: tokenRefreshRequest.postRequestScript,
      testScript: tokenRefreshRequest.testScript,
      headers: tokenRefreshRequest.headers,
      body: tokenRefreshRequest.body,
      bodyType: tokenRefreshRequest.bodyType,
      rawType: tokenRefreshRequest.rawType,
      graphqlQuery: tokenRefreshRequest.graphqlQuery,
      graphqlVariables: tokenRefreshRequest.graphqlVariables,
      tlsVerificationMode: tokenRefreshRequest.tlsVerificationMode,
      activeEnvironmentIds: input.input.activeEnvironmentIds,
      saveToHistory: tokenRefreshRequest.saveToHistory,
      historyKeepLast: input.input.historyKeepLast,
      requestMetadata: {
        sourceRuntime: 'call-request',
        isRetry: false,
        retryCount: 0,
      },
    },
    input.options
  )
  if (!refreshResult.success || refreshResult.data.status < 200 || refreshResult.data.status >= 300) {
    return false
  }

  return true
}

function emitRetryRequestEvent(requestId: string, requestMetadata: SendRequestInput['requestMetadata']) {
  emitGenericEvent({
    type: 'retry-request',
    requestId,
    requestMetadata: buildRetriedRequestMetadata(requestMetadata),
  })
}

function buildRetriedRequestMetadata(requestMetadata: SendRequestInput['requestMetadata']) {
  return {
    sourceRuntime: 'request-editor' as const,
    isRetry: true,
    retryCount: (requestMetadata?.retryCount ?? 0) + 1,
  }
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

async function resolveRequestTlsDispatcher(
  url: string,
  requestId: string,
  requestMode: SendRequestInput['tlsVerificationMode']
) {
  const appSettingsMode: AppSettingsTlsVerificationMode = await getAppSettings()
    .then(settings => settings.tlsVerificationMode)
    .catch(() => DEFAULT_APP_SETTINGS_TLS_VERIFICATION_MODE)
  const folderModes = await getRequestParentFolderId(requestId)
    .then(folderId => getFolderAncestorChain(folderId))
    .then(folders => folders.map(folder => folder.tlsVerificationMode ?? 'inherit'))
    .catch(() => [])

  return getTlsDispatcher(
    url,
    resolveEffectiveTlsVerificationMode({
      requestMode,
      folderModes,
      appSettingsMode,
    })
  )
}
