import { describe, expect, it } from 'vitest'
import { analyzeCollectionExportSource, buildCollectionExportDocument } from './postman-export.js'

describe('postman export', () => {
  it('warns when folder headers must be stored in metadata', () => {
    const analysis = analyzeCollectionExportSource({
      scope: 'workspace',
      folderId: null,
      requestId: null,
      suggestedCollectionName: 'Workspace',
      folders: [
        {
          id: 'folder-1',
          name: 'Users',
          description: '',
          headers: 'x-team:api',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
      ],
      requests: [],
      examplesByRequestId: new Map(),
      orderedItems: [{ itemType: 'folder', id: 'folder-1', parentFolderId: null, name: 'Users', position: 0, createdAt: 1, deletedAt: null }],
    })

    expect(analysis.warnings.map(warning => warning.code)).toContain('folder-headers-stored-in-metadata')
  })

  it('exports response snapshot overrides via originalRequest', () => {
    const document = buildCollectionExportDocument({
      scope: 'workspace',
      folderId: null,
      requestId: null,
      suggestedCollectionName: 'Workspace',
      folders: [],
      requests: [
        {
          id: 'request-1',
          name: 'Create User',
          requestType: 'http',
          method: 'POST',
          url: 'https://api.example.com/users/:userId',
          pathParams: 'userId:42 // User id',
          searchParams: 'expand:teams',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          prefersResponseVisualizer: false,
          headers: 'content-type:application/json',
          body: '{"name":"Ada"}',
          bodyType: 'raw',
          rawType: 'json',
          websocketSubprotocols: '',
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
      ],
      examplesByRequestId: new Map([
        [
          'request-1',
          [
            {
              id: 'example-1',
              requestId: 'request-1',
              name: 'Created',
              position: 0,
              requestHeaders: 'content-type:application/json\nx-trace:test',
              requestBody: '{"name":"Grace"}',
              requestBodyType: 'raw',
              requestRawType: 'json',
              responseStatus: 201,
              responseStatusText: 'Created',
              responseHeaders: 'content-type:application/json',
              responseBody: '{"ok":true}',
              createdAt: 1,
              updatedAt: 1,
              deletedAt: null,
            },
          ],
        ],
      ]),
      orderedItems: [{ itemType: 'request', id: 'request-1', parentFolderId: null, name: 'Create User', requestType: 'http', method: 'POST', url: 'https://api.example.com/users/:userId', position: 0, createdAt: 1, deletedAt: null }],
    }, 'Workspace')

    expect(document.item[0]?.response?.[0]?.originalRequest?.header).toEqual(
      expect.arrayContaining([{ key: 'x-trace', value: 'test' }])
    )
    expect(document.item[0]?.response?.[0]?.originalRequest?.body).toEqual({
      mode: 'raw',
      raw: '{"name":"Grace"}',
      options: { raw: { language: 'json' } },
    })
    expect(document.item[0]?.request?.url.variable).toEqual([{ key: 'userId', value: '42', description: 'User id' }])
  })

  it('treats folder-scoped exports as standalone collections', () => {
    const document = buildCollectionExportDocument({
      scope: 'folder',
      folderId: 'folder-1',
      requestId: null,
      suggestedCollectionName: 'Users',
      folders: [
        {
          id: 'folder-1',
          name: 'Users',
          description: 'User management endpoints',
          headers: 'x-team:api',
          auth: { type: 'bearer', token: '{{token}}' },
          preRequestScript: 'const token = kova.env.get("token")',
          postRequestScript: 'kova.test("ok", () => true)',
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
        {
          id: 'folder-2',
          name: 'Admin',
          description: '',
          headers: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          createdAt: 1,
          deletedAt: null,
          parentFolderId: 'folder-1',
          position: 0,
        },
      ],
      requests: [],
      examplesByRequestId: new Map(),
      orderedItems: [
        { itemType: 'folder', id: 'folder-1', parentFolderId: null, name: 'Users', position: 0, createdAt: 1, deletedAt: null },
        { itemType: 'folder', id: 'folder-2', parentFolderId: 'folder-1', name: 'Admin', position: 0, createdAt: 1, deletedAt: null },
      ],
    }, 'Users')

    expect(document.info.name).toBe('Users')
    expect(document.description).toBe('User management endpoints')
    expect(document.auth).toEqual({ type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] })
    expect(document.event).toEqual([
      { listen: 'prerequest', script: { exec: ['const token = kova.env.get("token")'], type: 'text/javascript' } },
      { listen: 'test', script: { exec: ['kova.test("ok", () => true)'], type: 'text/javascript' } },
    ])
    expect(document._kova).toEqual({ exportedByKova: true, folderHeaders: 'x-team:api' })
    expect(document.item[0]?.name).toBe('Admin')
  })

  it('exports a single request as a top-level collection item', () => {
    const document = buildCollectionExportDocument({
      scope: 'request',
      folderId: null,
      requestId: 'request-1',
      suggestedCollectionName: 'Create User',
      folders: [],
      requests: [
        {
          id: 'request-1',
          name: 'Create User',
          requestType: 'http',
          method: 'POST',
          url: 'https://api.example.com/users',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          prefersResponseVisualizer: false,
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
      ],
      examplesByRequestId: new Map(),
      orderedItems: [{ itemType: 'request', id: 'request-1', parentFolderId: null, name: 'Create User', requestType: 'http', method: 'POST', url: 'https://api.example.com/users', position: 0, createdAt: 1, deletedAt: null }],
    }, 'Create User')

    expect(document.info.name).toBe('Create User')
    expect(document.item).toHaveLength(1)
    expect(document._kova).toEqual({ exportedByKova: true, folderHeaders: undefined })
    expect(document.item[0]?.name).toBe('Create User')
    expect(document.item[0]?.request?.method).toBe('POST')
  })
})
