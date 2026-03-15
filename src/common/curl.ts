import parseCurl from 'parse-curl'
import { stringifyKeyValueRows, type KeyValueRow } from './KeyValueRows.js'
import type { HttpAuth } from './Auth.js'
import type { RequestBodyType, RequestMethod, RequestRawType } from './Requests.js'
import { syncPathParamsWithUrl, syncSearchParamsWithUrl } from './PathParams.js'

export type ParsedCurlRequest = {
  method: RequestMethod
  url: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  auth: HttpAuth
  pathParams: string
  searchParams: string
}

const REQUEST_METHODS = new Set<RequestMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export function parseCurlRequest(value: string): ParsedCurlRequest | null {
  const parsed = parseCurl(normalizeCurlCommand(value))
  if (!parsed?.url) {
    return null
  }

  const url = parsed.url.trim()
  const method = normalizeMethod(parsed.method)
  const headers = normalizeHeaders(parsed.header ?? {})
  const rawBody = parsed.body ?? ''
  const { auth, headersWithoutAuth } = deriveAuth(headers)
  const contentType = (parsed.header?.['Content-Type'] ?? parsed.header?.['content-type'] ?? '').toLowerCase()
  const bodyType = inferBodyType(rawBody, contentType)
  const rawType = inferRawType(rawBody, contentType)
  const body = normalizeBody(rawBody, bodyType)

  return {
    method,
    url,
    headers: headersWithoutAuth,
    body,
    bodyType,
    rawType,
    auth,
    pathParams: syncPathParamsWithUrl(url, ''),
    searchParams: syncSearchParamsWithUrl(url, ''),
  }
}

function normalizeMethod(value: string | undefined): RequestMethod {
  const method = value?.trim().toUpperCase()
  return method && REQUEST_METHODS.has(method as RequestMethod) ? (method as RequestMethod) : 'GET'
}

function normalizeHeaders(headers: Record<string, string>) {
  const rows = Object.entries(headers).map(([key, value], index) => ({
    id: `curl-header-${index}`,
    enabled: true,
    key,
    value,
    description: '',
  }) satisfies KeyValueRow)

  return stringifyKeyValueRows(rows)
}

function deriveAuth(headersValue: string): { auth: HttpAuth; headersWithoutAuth: string } {
  const rows = headersValue ? headersValue.split('\n') : []
  const nextRows: string[] = []
  let auth: HttpAuth = { type: 'inherit' }

  for (const row of rows) {
    const separatorIndex = row.indexOf(':')
    if (separatorIndex < 0) {
      nextRows.push(row)
      continue
    }

    const key = row.slice(0, separatorIndex).trim()
    const value = row.slice(separatorIndex + 1).trim()
    if (key.toLowerCase() !== 'authorization') {
      nextRows.push(row)
      continue
    }

    if (value.startsWith('Bearer ')) {
      auth = { type: 'bearer', token: value.slice('Bearer '.length) }
      continue
    }

    if (value.startsWith('Basic ')) {
      auth = { type: 'basic', username: '', password: '' }
      nextRows.push(row)
      continue
    }

    nextRows.push(row)
  }

  return { auth, headersWithoutAuth: nextRows.join('\n') }
}

function inferBodyType(body: string, contentType: string): RequestBodyType {
  if (!body) {
    return 'none'
  }

  if (contentType.includes('json') || looksLikeJson(body)) {
    return 'raw'
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return 'x-www-form-urlencoded'
  }

  return 'raw'
}

function inferRawType(body: string, contentType: string): RequestRawType {
  if (!body) {
    return 'json'
  }

  if (contentType.includes('json') || looksLikeJson(body)) {
    return 'json'
  }

  try {
    JSON.parse(body)
    return 'json'
  }

  catch {
    return 'text'
  }
}

function normalizeCurlCommand(value: string) {
  return value
    .trim()
    .replaceAll(/(^|\s)--data-raw(?=\s)/g, '$1--data')
    .replaceAll(/(^|\s)--data-binary(?=\s)/g, '$1--data')
    .replaceAll(/(^|\s)--data-urlencode(?=\s)/g, '$1--data')
    .replaceAll(/(^|\s)--url(?=\s)/g, '$1')
}

function normalizeBody(body: string, bodyType: RequestBodyType) {
  if (bodyType !== 'x-www-form-urlencoded' || !body) {
    return body
  }

  const rows: KeyValueRow[] = []
  const searchParams = new URLSearchParams(body)
  let index = 0

  for (const [key, value] of searchParams.entries()) {
    rows.push({
      id: `curl-form-${index}`,
      enabled: true,
      key,
      value,
      description: '',
    })
    index += 1
  }

  return stringifyKeyValueRows(rows)
}

function looksLikeJson(body: string) {
  const normalized = body.trim()
  if (!normalized || !/^[\[{]/.test(normalized)) {
    return false
  }

  try {
    JSON.parse(normalized)
    return true
  } catch {
    return false
  }
}
