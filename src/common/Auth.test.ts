import { describe, expect, it } from 'vitest'
import { getAuthHeaders, getAuthQueryParams, normalizeHttpAuth, resolveAuth, resolveInheritedAuth } from './Auth.js'

describe('Auth', () => {
  it('resolves inherited auth from folders and request overrides', () => {
    expect(
      resolveInheritedAuth(
        [{ type: 'bearer', token: '{{folderToken}}' }, { type: 'inherit' }, { type: 'basic', username: 'user', password: 'pass' }],
        { type: 'inherit' }
      )
    ).toEqual({ type: 'basic', username: 'user', password: 'pass' })

    expect(resolveInheritedAuth([{ type: 'bearer', token: '{{folderToken}}' }], { type: 'noauth' })).toEqual({ type: 'noauth' })
  })

  it('builds auth headers for bearer and basic auth', () => {
    expect(getAuthHeaders({ type: 'bearer', token: 'abc' })).toEqual([{ key: 'Authorization', value: 'Bearer abc' }])
    expect(getAuthHeaders({ type: 'basic', username: 'foo', password: 'bar' })).toEqual([
      { key: 'Authorization', value: 'Basic Zm9vOmJhcg==' },
    ])
  })

  it('builds query params for query api key auth', () => {
    expect(getAuthQueryParams({ type: 'apikey', key: 'api_key', value: '{{token}}', addTo: 'query' })).toEqual([
      { key: 'api_key', value: '{{token}}' },
    ])
  })

  it('resolves variable values inside auth fields', () => {
    expect(resolveAuth({ type: 'apikey', key: 'Authorization', value: '{{token}}', addTo: 'header' }, { token: 'secret' })).toEqual({
      type: 'apikey',
      key: 'Authorization',
      value: 'secret',
      addTo: 'header',
    })
  })

  it('normalizes invalid auth payloads safely', () => {
    expect(normalizeHttpAuth({ type: 'apikey', key: 1 })).toEqual({ type: 'apikey', key: '', value: '', addTo: 'header' })
    expect(normalizeHttpAuth(null)).toEqual({ type: 'inherit' })
  })
})
