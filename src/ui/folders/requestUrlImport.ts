import { syncPathParamsWithUrl, syncSearchParamsWithUrl } from '@common/PathParams'
import type { RequestBodyType } from '@common/Requests'

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
