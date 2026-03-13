import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { SendRequestInput, SendRequestResponse } from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'

export async function sendRequest(input: SendRequestInput): Promise<GenericResult<SendRequestResponse>> {
  const url = input.url.trim()

  if (!url) {
    return GenericError.Message('Request URL is required')
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return GenericError.Message('Request URL is invalid')
  }

  try {
    const headers = new Headers()
    for (const row of parseKeyValueRows(input.headers)) {
      if (!row.enabled || !row.key.trim()) continue
      headers.append(row.key.trim(), row.value)
    }

    const body = buildRequestBody(input, headers)
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

function buildRequestBody(input: SendRequestInput, headers: Headers) {
  switch (input.bodyType) {
    case 'none':
      return undefined
    case 'raw': {
      if (input.body && !headers.has('content-type')) {
        headers.set('content-type', input.rawType === 'json' ? 'application/json' : 'text/plain')
      }
      return input.body
    }
    case 'form-data': {
      const formData = new FormData()
      for (const row of parseKeyValueRows(input.body)) {
        if (!row.enabled || !row.key.trim()) continue
        formData.append(row.key.trim(), row.value)
      }
      return formData
    }
    case 'x-www-form-urlencoded': {
      const searchParams = new URLSearchParams()
      for (const row of parseKeyValueRows(input.body)) {
        if (!row.enabled || !row.key.trim()) continue
        searchParams.append(row.key.trim(), row.value)
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
