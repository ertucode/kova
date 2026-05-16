import { describe, expect, it } from 'vitest'
import { syncSearchParamsWithUrl } from '@common/PathParams'
import {
  buildImportedHttpUrlFields,
  buildImportedWebSocketUrlFields,
  getImportedRequestNameFromUrl,
  parseClipboardHttpRequest,
} from './requestUrlImport'

describe('requestUrlImport', () => {
  it('rebuilds HTTP URL fields from scratch for pasted URLs', () => {
    const result = buildImportedHttpUrlFields('https://api.example.com/orders?page=2&sort=desc', 'none')

    expect(result).toEqual({
      url: 'https://api.example.com/orders?page=2&sort=desc',
      pathParams: '',
      searchParams: 'page:2\nsort:desc',
      metaTab: 'search-params',
    })
  })

  it('rebuilds HTTP URL imports from scratch instead of preserving stale search params', () => {
    expect(syncSearchParamsWithUrl('https://api.example.com/orders?page=2', 'stale:1\npage:1')).toBe('page:2')

    const result = buildImportedHttpUrlFields('https://api.example.com/orders?page=2', 'none')
    expect(result.searchParams).toBe('page:2')
  })

  it('keeps HTTP imports on overview when the request body is not none', () => {
    const result = buildImportedHttpUrlFields('https://api.example.com/orders?page=2', 'raw')

    expect(result.metaTab).toBe('overview')
  })

  it('rebuilds WebSocket search params from scratch for pasted URLs', () => {
    const result = buildImportedWebSocketUrlFields('wss://echo.websocket.events?room=blue&user=42')

    expect(result).toEqual({
      url: 'wss://echo.websocket.events?room=blue&user=42',
      searchParams: 'room:blue\nuser:42',
      metaTab: 'search-params',
    })
  })

  it('uses the last URL path segment as the imported request name', () => {
    expect(getImportedRequestNameFromUrl('https://api.example.com/orders/42')).toBe('42')
    expect(getImportedRequestNameFromUrl('https://api.example.com/orders/list%20all')).toBe('list all')
  })

  it('falls back to the default imported request name when there is no path segment', () => {
    expect(getImportedRequestNameFromUrl('https://api.example.com')).toBe('Untitled')
    expect(getImportedRequestNameFromUrl('https://api.example.com/')).toBe('Untitled')
  })

  it('parses raw URLs from the clipboard into a new HTTP request draft', () => {
    expect(parseClipboardHttpRequest('https://api.example.com/orders?page=2')).toEqual({
      name: 'orders',
      method: 'GET',
      url: 'https://api.example.com/orders?page=2',
      pathParams: '',
      searchParams: 'page:2',
      auth: { type: 'inherit' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'json',
    })
  })

  it('parses cURL from the clipboard into a fully populated HTTP request draft', () => {
    expect(parseClipboardHttpRequest("curl -X POST 'https://api.example.com/orders' -H 'Content-Type: application/json' -d '{\"id\":42}'")).toEqual({
      name: 'orders',
      method: 'POST',
      url: 'https://api.example.com/orders',
      pathParams: '',
      searchParams: '',
      auth: { type: 'inherit' },
      headers: 'Content-Type:application/json',
      body: '{"id":42}',
      bodyType: 'raw',
      rawType: 'json',
    })
  })
})
