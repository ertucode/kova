import { getAuthVariableSources } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { extractTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import type {
  ExecutedRequestSnapshot,
  ReceivedResponseSnapshot,
  RequestExecutionRecord,
  ScriptResponseBody,
  SendRequestInput,
  SendRequestResponse,
} from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { persistRequestHistory } from './db/request-history.js'
import { emitGenericEvent } from './generic-events.js'
import { prepareHttpRequest } from './http-request-runtime.js'

export async function sendRequest(input: SendRequestInput): Promise<GenericResult<SendRequestResponse>> {
  try {
    const preparedRequest = await prepareHttpRequest(input)
    if (!preparedRequest.success) {
      return preparedRequest
    }

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
    })
    const bodyText = await response.text()
    const durationMs = Date.now() - startedAt

    const responseHeaders = Array.from(response.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')

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
      id: crypto.randomUUID(),
      requestId: input.requestId,
      requestName,
      request: executedRequest,
      response: responseSnapshot,
      responseError: null,
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      consoleEntries: runtime.getConsoleEntries(),
    }

    let persistedExecution = execution
    try {
      persistedExecution = await persistRequestHistory({ execution, keepLast: input.historyKeepLast })
    } catch (historyError) {
      console.error('persistRequestHistory failed', historyError)
    }

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      durationMs,
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      updatedEnvironments,
      consoleEntries: runtime.getConsoleEntries(),
      execution: persistedExecution,
    })
  } catch (error) {
    console.error('sendRequest failed', error)
    return GenericError.Message(formatRequestError(error))
  }
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
