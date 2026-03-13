import { GenericError, type GenericResult } from '../common/GenericError.js'
import { buildEnvironmentVariableMap, resolveTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import type { SendRequestInput, SendRequestResponse } from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { getEnvironmentsByIds } from './db/environments.js'

export async function sendRequest(input: SendRequestInput): Promise<GenericResult<SendRequestResponse>> {
  try {
    const activeEnvironments = await getEnvironmentsByIds(input.activeEnvironmentIds)
    const variables = buildEnvironmentVariableMap(activeEnvironments)
    const url = resolveTemplateVariables(input.url, variables).trim()

    if (!url) {
      return GenericError.Message('Request URL is required')
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return GenericError.Message('Request URL is invalid')
    }

    const headers = new Headers()
    for (const row of parseKeyValueRows(input.headers)) {
      const key = resolveTemplateVariables(row.key, variables).trim()
      if (!row.enabled || !key) continue
      headers.append(key, resolveTemplateVariables(row.value, variables))
    }

    const body = buildRequestBody(input, headers, variables)
    const startedAt = Date.now()
    const response = await fetch(parsedUrl, {
      method: input.method,
      headers,
      body,
    })
    const bodyText = await response.text()
    const durationMs = Date.now() - startedAt

    return Result.Success({
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(response.headers.entries())
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      body: bodyText,
      durationMs,
    })
  } catch (error) {
    console.error('sendRequest failed', error)
    return GenericError.Message(formatRequestError(error))
  }
}

function buildRequestBody(input: SendRequestInput, headers: Headers, variables: Record<string, string>) {
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
        if (!row.enabled || !key) continue
        formData.append(key, resolveTemplateVariables(row.value, variables))
      }
      return formData
    }
    case 'x-www-form-urlencoded': {
      const searchParams = new URLSearchParams()
      for (const row of parseKeyValueRows(input.body)) {
        const key = resolveTemplateVariables(row.key, variables).trim()
        if (!row.enabled || !key) continue
        searchParams.append(key, resolveTemplateVariables(row.value, variables))
      }
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/x-www-form-urlencoded')
      }
      return searchParams
    }
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
