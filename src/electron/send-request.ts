import { GenericError, type GenericResult } from '../common/GenericError.js'
import { findMissingTemplateVariables, resolveTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import type { RequestMethod, ScriptResponseBody, SendRequestInput, SendRequestResponse } from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { getEnvironmentsByIds } from './db/environments.js'
import { getFolderAncestorChain } from './db/folders.js'
import { getRequest } from './db/requests.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { emitGenericEvent } from './generic-events.js'
import { createRequestScriptRuntime } from './request-script-runner.js'

const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export async function sendRequest(input: SendRequestInput): Promise<GenericResult<SendRequestResponse>> {
  try {
    const requestResult = await getRequest({ id: input.requestId })
    if (!requestResult.success) {
      return requestResult
    }

    const [activeEnvironments, parentFolderId] = await Promise.all([
      getEnvironmentsByIds(input.activeEnvironmentIds),
      getRequestParentFolderId(input.requestId),
    ])

    const folders = await getFolderAncestorChain(parentFolderId)
    const runtime = createRequestScriptRuntime({
      request: {
        method: input.method,
        url: input.url,
        headers: input.headers,
        body: input.body,
        bodyType: input.bodyType,
        rawType: input.rawType,
      },
      environments: activeEnvironments,
    })

    await runtime.runPreRequestScripts([
      ...folders.map(folder => ({ name: `Folder: ${folder.name}`, script: folder.preRequestScript })),
      { name: `Request: ${requestResult.data.name}`, script: input.preRequestScript },
    ])

    const variables = runtime.getResolvedVariables()
    const missingVariables = collectMissingVariables(runtime.request, variables)
    if (missingVariables.length > 0) {
      return GenericError.Message(
        `Missing environment variables: ${missingVariables.join(', ')}. Define them before sending the request.`
      )
    }

    const url = resolveTemplateVariables(runtime.request.url, variables).trim()
    if (!url) {
      return GenericError.Message('Request URL is required')
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return GenericError.Message('Request URL is invalid')
    }

    if (!REQUEST_METHODS.includes(runtime.request.method)) {
      return GenericError.Message('Invalid request method')
    }

    const headers = new Headers()
    for (const row of parseKeyValueRows(runtime.request.headers)) {
      const key = resolveTemplateVariables(row.key, variables).trim()
      if (!row.enabled || !key) {
        continue
      }

      headers.append(key, resolveTemplateVariables(row.value, variables))
    }

    const body = buildRequestBody(runtime.request, headers, variables)
    const startedAt = Date.now()
    const response = await fetch(parsedUrl, {
      method: runtime.request.method,
      headers,
      body,
    })
    const bodyText = await response.text()
    const durationMs = Date.now() - startedAt

    const responseHeaders = Array.from(response.headers.entries())
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')

    const scriptErrors = await runtime.runPostRequestScripts(
      [
        { name: `Request: ${requestResult.data.name}`, script: input.postRequestScript },
        ...folders
          .slice()
          .reverse()
          .map(folder => ({ name: `Folder: ${folder.name}`, script: folder.postRequestScript })),
      ],
      {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: parseScriptResponseBody(bodyText, responseHeaders),
      }
    )

    const updatedEnvironments = runtime.getUpdatedEnvironments()
    if (updatedEnvironments.length > 0) {
      emitGenericEvent({
        type: 'environments-updated',
        environmentIds: updatedEnvironments.map(environment => environment.id),
      })
    }

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      durationMs,
      scriptErrors: scriptErrors.map(error => ({ ...error, phase: 'post-request' as const })),
      updatedEnvironments,
    })
  } catch (error) {
    console.error('sendRequest failed', error)
    return GenericError.Message(formatRequestError(error))
  }
}

function collectMissingVariables(
  input: Pick<SendRequestInput, 'url' | 'headers' | 'body' | 'bodyType'>,
  variables: Record<string, string>
) {
  const missingVariables = new Set<string>()

  for (const variableName of findMissingTemplateVariables(input.url, variables)) {
    missingVariables.add(variableName)
  }

  for (const row of parseKeyValueRows(input.headers)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of findMissingTemplateVariables(row.key, variables)) {
      missingVariables.add(variableName)
    }

    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  if (input.bodyType === 'raw') {
    for (const variableName of findMissingTemplateVariables(input.body, variables)) {
      missingVariables.add(variableName)
    }
  }

  if (input.bodyType === 'form-data' || input.bodyType === 'x-www-form-urlencoded') {
    for (const row of parseKeyValueRows(input.body)) {
      if (!row.enabled) {
        continue
      }

      for (const variableName of findMissingTemplateVariables(row.key, variables)) {
        missingVariables.add(variableName)
      }

      for (const variableName of findMissingTemplateVariables(row.value, variables)) {
        missingVariables.add(variableName)
      }
    }
  }

  return Array.from(missingVariables).sort((left, right) => left.localeCompare(right))
}

function buildRequestBody(
  input: Pick<SendRequestInput, 'bodyType' | 'body' | 'rawType'>,
  headers: Headers,
  variables: Record<string, string>
) {
  switch (input.bodyType) {
    case 'none':
      return undefined
    case 'raw': {
      if (input.body && !headers.has('content-type')) {
        headers.set('content-type', input.rawType === 'json' ? 'application/json' : 'text/plain')
      }
      return resolveTemplateVariables(input.body, variables)
    }
    case 'form-data': {
      const formData = new FormData()
      for (const row of parseKeyValueRows(input.body)) {
        const key = resolveTemplateVariables(row.key, variables).trim()
        if (!row.enabled || !key) {
          continue
        }

        formData.append(key, resolveTemplateVariables(row.value, variables))
      }
      return formData
    }
    case 'x-www-form-urlencoded': {
      const searchParams = new URLSearchParams()
      for (const row of parseKeyValueRows(input.body)) {
        const key = resolveTemplateVariables(row.key, variables).trim()
        if (!row.enabled || !key) {
          continue
        }

        searchParams.append(key, resolveTemplateVariables(row.value, variables))
      }
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/x-www-form-urlencoded')
      }
      return searchParams
    }
  }
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
