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
  graphqlQuery: string
  graphqlVariables: string
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
  const { auth, headersWithoutAuth } = deriveAuth(stringifyKeyValueRows(headers))
  const contentType = (headers.find(row => row.key.toLowerCase() === 'content-type')?.value ?? '').toLowerCase()
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
    graphqlQuery: '',
    graphqlVariables: '',
    auth,
    pathParams: syncPathParamsWithUrl(url, ''),
    searchParams: syncSearchParamsWithUrl(url, ''),
  }
}

function normalizeMethod(value: string | undefined): RequestMethod {
  const method = value?.trim().toUpperCase()
  return method && REQUEST_METHODS.has(method as RequestMethod) ? (method as RequestMethod) : 'GET'
}

function normalizeHeaders(headers: Record<string, string | undefined>): KeyValueRow[] {
  // parse-curl injects this default for --data unless it finds the exact key
  // "Content-Type". Prefer explicit headers regardless of casing or spacing.
  const entries = Object.entries(headers)
  const hasExplicitContentType = entries.some(
    ([key]) => key !== 'Content-Type' && key.split(':', 1)[0].trim().toLowerCase() === 'content-type'
  )

  return entries
    .filter(
      ([key, value]) =>
        !(hasExplicitContentType && key === 'Content-Type' && value === 'application/x-www-form-urlencoded')
    )
    .map(([key, value], index) => {
      // parse-curl only splits headers at ": ", leaving compact and empty headers in the key.
      const separatorIndex = key.indexOf(':')
      if (value === undefined) {
        value = separatorIndex >= 0 ? key.slice(separatorIndex + 1).trim() : ''
        key = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key.replace(/;$/, '')
      }

      return {
        id: `curl-header-${index}`,
        enabled: true,
        key: key.trim(),
        value,
        description: '',
      }
    })
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
  } catch {
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
