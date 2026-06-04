import { describe, expect, it } from 'vitest'
import { analyzeOpenApiExportSource, buildOpenApiExportDocument } from './openapi-export.js'

describe('openapi export', () => {
  it('uses immediate folder tags when a folder export has only one nested level', () => {
    const document = buildOpenApiExportDocument({
      scope: 'folder',
      folderId: 'root',
      requestId: null,
      suggestedSpecName: 'Users',
      folders: [
        {
          id: 'root',
          name: 'Users',
          description: '',
          headers: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
        {
          id: 'child',
          name: 'Admin',
          description: '',
          headers: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          createdAt: 1,
          deletedAt: null,
          parentFolderId: 'root',
          position: 0,
        },
      ],
      requests: [
        {
          id: 'request-1',
          name: 'List admins',
          requestType: 'http',
          method: 'GET',
          url: 'https://api.example.com/admins',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: 'child',
          position: 0,
        },
      ],
      examplesByRequestId: new Map(),
      ancestorFoldersByRequestId: new Map([['request-1', [{ id: 'root', name: 'Users', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null }, { id: 'child', name: 'Admin', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null }]]]),
    }, 'Users')

    expect(document.servers).toEqual([{ url: 'https://api.example.com' }])
    expect(document.paths['/admins']?.get?.tags).toEqual(['Admin'])
  })

  it('omits tags when a folder export contains deeper nested folders', () => {
    const document = buildOpenApiExportDocument({
      scope: 'folder',
      folderId: 'root',
      requestId: null,
      suggestedSpecName: 'Users',
      folders: [
        { id: 'root', name: 'Users', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null, parentFolderId: null, position: 0 },
        { id: 'child', name: 'Admin', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null, parentFolderId: 'root', position: 0 },
        { id: 'grandchild', name: 'Audit', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null, parentFolderId: 'child', position: 0 },
      ],
      requests: [
        {
          id: 'request-1',
          name: 'List audits',
          requestType: 'http',
          method: 'GET',
          url: 'https://api.example.com/audits',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: 'grandchild',
          position: 0,
        },
      ],
      examplesByRequestId: new Map(),
      ancestorFoldersByRequestId: new Map([['request-1', [{ id: 'root', name: 'Users', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null }, { id: 'child', name: 'Admin', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null }, { id: 'grandchild', name: 'Audit', description: '', headers: '', auth: { type: 'inherit' }, preRequestScript: '', postRequestScript: '', createdAt: 1, deletedAt: null }]]]),
    }, 'Users')

    expect(document.paths['/audits']?.get?.tags).toBeUndefined()
  })

  it('exports auth, params, request body, and response examples', () => {
    const document = buildOpenApiExportDocument({
      scope: 'request',
      folderId: null,
      requestId: 'request-1',
      suggestedSpecName: 'Create User',
      folders: [],
      requests: [
        {
          id: 'request-1',
          name: 'Create User',
          requestType: 'http',
          method: 'POST',
          url: 'https://api.example.com/users/:userId?page=2',
          pathParams: 'userId:42 // User id',
          searchParams: 'page:2',
          auth: { type: 'bearer', token: '{{token}}' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: 'x-trace-id:trace-1\ncontent-type:application/json',
          body: '{"name":"Ada"}',
          bodyType: 'raw',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
      ],
      examplesByRequestId: new Map([['request-1', [{ id: 'example-1', requestId: 'request-1', name: 'Created', position: 0, requestHeaders: '', requestBody: '{"name":"Grace"}', requestBodyType: 'raw', requestRawType: 'json', responseStatus: 201, responseStatusText: 'Created', responseHeaders: 'content-type:application/json', responseBody: '{"ok":true}', createdAt: 1, updatedAt: 1, deletedAt: null }]]]),
      ancestorFoldersByRequestId: new Map([['request-1', []]]),
    }, 'Create User')

    expect(document.components?.securitySchemes?.bearerAuth).toEqual({ type: 'http', scheme: 'bearer' })
    expect(document.paths['/users/{userId}']?.post?.security).toEqual([{ bearerAuth: [] }])
    expect(document.paths['/users/{userId}']?.post?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'userId', in: 'path', required: true, example: '42' }),
        expect.objectContaining({ name: 'page', in: 'query', example: '2' }),
        expect.objectContaining({ name: 'x-trace-id', in: 'header', example: 'trace-1' }),
        expect.objectContaining({ name: 'Authorization', in: 'header', example: 'Bearer {{token}}' }),
      ])
    )
    expect(document.paths['/users/{userId}']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          example: { name: 'Ada' },
          examples: { Created: { value: { name: 'Grace' } } },
        },
      },
    })
    expect(document.paths['/users/{userId}']?.post?.responses['201']).toEqual({
      description: 'Created',
      content: {
        'application/json': {
          example: { ok: true },
          examples: { Created: { value: { ok: true } } },
        },
      },
    })
  })

  it('reports skipped websocket requests, duplicates, disabled rows, and mixed servers', () => {
    const analysis = analyzeOpenApiExportSource({
      scope: 'workspace',
      folderId: null,
      requestId: null,
      suggestedSpecName: 'Workspace',
      folders: [],
      requests: [
        {
          id: 'request-1',
          name: 'List users',
          requestType: 'http',
          method: 'GET',
          url: 'https://api.example.com/users',
          pathParams: '',
          searchParams: '//page:2',
          auth: { type: 'inherit' },
          preRequestScript: 'console.log("x")',
          postRequestScript: '',
          responseVisualizer: 'return []',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 0,
        },
        {
          id: 'request-2',
          name: 'List users duplicate',
          requestType: 'http',
          method: 'GET',
          url: 'https://api.second.example.com/users',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 1,
        },
        {
          id: 'request-3',
          name: 'Socket',
          requestType: 'websocket',
          method: 'GET',
          url: 'wss://example.com',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: 1,
          deletedAt: null,
          parentFolderId: null,
          position: 2,
        },
      ],
      examplesByRequestId: new Map(),
      ancestorFoldersByRequestId: new Map([['request-1', []], ['request-2', []], ['request-3', []]]),
    })

    expect(analysis.warnings.map(warning => warning.code)).toEqual(expect.arrayContaining([
      'websocket-requests-skipped',
      'duplicate-path-method-skipped',
      'disabled-rows-skipped',
      'mixed-servers-exported-with-operation-servers',
      'request-scripts-not-exported',
      'response-visualizer-not-exported',
    ]))
  })
})
