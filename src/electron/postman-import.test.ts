import { describe, expect, it } from 'vitest'
import { analyzeCollectionDocument, mapAuth, mapRequest, mapScripts } from './postman-import.js'

describe('postman import', () => {
  it('reports warnings for commented scripts and unsupported features', () => {
    const analysis = analyzeCollectionDocument({
      info: { name: 'Sample' },
      _kova: { folderHeaders: 'x-team:api' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      event: [{ listen: 'test', script: { exec: ['pm.test("collection ok")'] } }],
      variable: [{ key: 'baseUrl' }],
      protocolProfileBehavior: { disableBodyPruning: true },
      item: [
        {
          name: 'Folder',
          event: [{ listen: 'prerequest', script: { exec: ['pm.environment.set("token", "1")'] } }],
          item: [
            {
              name: 'Request',
              request: {
                method: 'POST',
                auth: { type: 'oauth2' },
                body: { mode: 'graphql' },
              },
              response: [{ name: 'example' }],
            },
          ],
        },
      ],
    })

    expect(analysis.collectionName).toBe('Sample')
    expect(analysis.folderCount).toBe(1)
    expect(analysis.requestCount).toBe(1)
    expect(analysis.exportedByKova).toBe(false)
    expect(analysis.hasCollectionAuth).toBe(true)
    expect(analysis.hasCollectionScripts).toBe(true)
    expect(analysis.hasCollectionHeaders).toBe(true)
    expect(analysis.hasCollectionVariables).toBe(true)
    expect(analysis.hasCollectionProtocolProfileBehavior).toBe(true)
    expect(analysis.warnings.map(warning => warning.code)).toEqual(
      expect.arrayContaining([
        'scripts-commented',
        'unsupported-script-api',
        'unsupported-auth',
        'unsupported-body-mode',
        'collection-variables-ignored',
        'protocol-profile-ignored',
      ])
    )
  })

  it('maps request url, params, headers, and form body', () => {
    const request = mapRequest({
      method: 'post',
      header: [{ key: 'x-test', value: '1' }],
      url: {
        raw: 'https://api.example.com/users/{{userId}}?page=2',
        query: [{ key: 'page', value: '2', description: 'Pagination' }],
        variable: [{ key: 'userId', value: '42', description: 'User id' }],
      },
      body: {
        mode: 'formdata',
        formdata: [
          { key: 'name', value: 'Ada' },
          { key: 'avatar', type: 'file', value: '/tmp/file.png' },
        ],
      },
    })

    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.example.com/users/:userId?page=2')
    expect(request.pathParams).toBe('userId:42 // User id')
    expect(request.searchParams).toBe('page:2 // Pagination')
    expect(request.headers).toBe('x-test:1')
    expect(request.bodyType).toBe('form-data')
    expect(request.body).toBe('name:Ada')
  })

  it('derives search params from raw url when query entries are missing', () => {
    const request = mapRequest({
      method: 'get',
      url: {
        raw: 'https://api.example.com/users/{{userId}}?page=2&filter=active#details',
        variable: [{ key: 'userId', value: '42' }],
      },
    })

    expect(request.url).toBe('https://api.example.com/users/:userId?page=2&filter=active')
    expect(request.searchParams).toBe('page:2\nfilter:active')
  })

  it('maps supported auth types and comments scripts', () => {
    expect(mapAuth({ type: 'apikey', apikey: [{ key: 'key', value: 'Authorization' }, { key: 'value', value: '{{token}}' }] }, true)).toEqual({
      type: 'apikey',
      key: 'Authorization',
      value: '{{token}}',
      addTo: 'header',
    })

    expect(mapScripts([{ listen: 'test', script: { exec: ['pm.test("ok")', 'console.log("x")'] } }], 'test')).toContain(
      '// pm.test("ok")'
    )
    expect(mapScripts([{ listen: 'test', script: { exec: ['console.log("kept")'] } }], 'test', true)).toBe('console.log("kept")')
  })

  it('does not add commented-script warnings for Kova exports', () => {
    const analysis = analyzeCollectionDocument({
      info: { name: 'Round Trip' },
      _kova: { exportedByKova: true },
      event: [{ listen: 'prerequest', script: { exec: ['console.log("root")'] } }],
      item: [
        {
          name: 'Request',
          event: [{ listen: 'test', script: { exec: ['console.log("item")'] } }],
          request: { method: 'GET', url: 'https://api.example.com' },
        },
      ],
    })

    expect(analysis.exportedByKova).toBe(true)
    expect(analysis.warnings.map(warning => warning.code)).not.toContain('scripts-commented')
  })
})
