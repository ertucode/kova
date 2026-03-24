import { describe, expect, it } from 'vitest'
import { syncSearchParamsWithUrl } from '@common/PathParams'
import { buildImportedHttpUrlFields, buildImportedWebSocketUrlFields } from './requestUrlImport'

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

  it('does not preserve stale search params during HTTP URL import', () => {
    expect(syncSearchParamsWithUrl('https://api.example.com/orders?page=2', 'stale:1\npage:1')).toBe('stale:1\npage:2')

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
})
