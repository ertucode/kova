import type { HttpAuth } from '@common/Auth'
import { parseCurlRequest } from '@common/curl'
import { syncPathParamsWithUrl, syncSearchParamsWithUrl } from '@common/PathParams'
import type { RequestBodyType, RequestMethod, RequestRawType } from '@common/Requests'

export const DEFAULT_IMPORTED_REQUEST_NAME = 'Untitled'

export type ClipboardHttpRequestImport = {
  name: string
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery: string
  graphqlVariables: string
}

export function buildImportedHttpUrlFields(nextUrl: string, bodyType: RequestBodyType) {
  const pathParams = syncPathParamsWithUrl(nextUrl, '')
  const searchParams = syncSearchParamsWithUrl(nextUrl, '')

  return {
    url: nextUrl,
    pathParams,
    searchParams,
    metaTab: bodyType === 'none' && searchParams.trim() ? 'search-params' : 'overview',
  } as const
}

export function buildImportedWebSocketUrlFields(nextUrl: string) {
  const searchParams = syncSearchParamsWithUrl(nextUrl, '')

  return {
    url: nextUrl,
    searchParams,
    metaTab: searchParams.trim() ? 'search-params' : 'overview',
  } as const
}

export function parseClipboardHttpRequest(
  value: string,
  fallbackName = DEFAULT_IMPORTED_REQUEST_NAME
): ClipboardHttpRequestImport | null {
  const parsedCurl = parseCurlRequest(value)
  if (parsedCurl) {
    return {
      name: getImportedRequestNameFromUrl(parsedCurl.url, fallbackName),
      ...parsedCurl,
    }
  }

  const nextUrl = value.trim()
  if (!nextUrl || nextUrl.includes('\n')) {
    return null
  }

  try {
    new URL(nextUrl)
  } catch {
    return null
  }

  const { metaTab: _metaTab, ...nextUrlFields } = buildImportedHttpUrlFields(nextUrl, 'none')

  return {
    name: getImportedRequestNameFromUrl(nextUrl, fallbackName),
    method: 'GET',
    ...nextUrlFields,
    auth: { type: 'inherit' },
    headers: '',
    body: '',
    bodyType: 'none',
    rawType: 'json',
    graphqlQuery: '',
    graphqlVariables: '',
  }
}

export function getImportedRequestNameFromUrl(url: string, fallbackName = DEFAULT_IMPORTED_REQUEST_NAME) {
  try {
    const pathSegment = new URL(url).pathname.split('/').map(segment => segment.trim()).filter(Boolean).at(-1)

    if (!pathSegment) {
      return fallbackName
    }

    try {
      return decodeURIComponent(pathSegment)
    } catch {
      return pathSegment
    }
  } catch {
    return fallbackName
  }
}
