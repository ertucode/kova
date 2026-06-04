import { describe, expect, it } from 'vitest'
import { analyzeOpenApiDocument, buildImportPlan } from './openapi-import.js'

describe('openapi import', () => {
  it('uses the first tag for foldering and warns about extra tags', () => {
    const plan = buildImportPlan({
      openapi: '3.0.3',
      info: { title: 'Tagged API' },
      paths: {
        '/users': {
          get: {
            summary: 'List users',
            tags: ['Users', 'Admin'],
          },
        },
      },
    })

    expect(plan.folderCount).toBe(1)
    expect(plan.requestCount).toBe(1)
    expect(plan.usesTags).toBe(true)
    expect(plan.operations[0]?.folderPath).toEqual(['Users'])
    expect(plan.warnings.map(warning => warning.code)).toContain('multiple-tags-first-used')
  })

  it('falls back to path-based folders when tags are missing', () => {
    const plan = buildImportPlan({
      openapi: '3.0.3',
      info: { title: 'Path API' },
      paths: {
        '/users/{userId}/posts': {
          get: {
            summary: 'List posts',
          },
        },
      },
    })

    expect(plan.folderCount).toBe(3)
    expect(plan.operations[0]?.folderPath).toEqual(['users', '{userId}', 'posts'])
    expect(plan.operations[0]?.url).toBe('/users/:userId/posts')
  })

  it('maps parameters, json bodies, auth, and multiple server warnings', () => {
    const plan = buildImportPlan({
      openapi: '3.0.3',
      info: { title: 'Users API' },
      servers: [
        { url: 'https://{env}.example.com/api', variables: { env: { default: 'staging' } } },
        { url: 'https://prod.example.com/api' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ bearerAuth: [] }],
      paths: {
        '/users/{userId}': {
          parameters: [{ name: 'userId', in: 'path', description: 'User id', schema: { type: 'string', default: '42' } }],
          get: {
            summary: 'Get user',
            parameters: [
              { name: 'expand', in: 'query', schema: { type: 'string', default: 'teams' } },
              { name: 'x-trace-id', in: 'header', schema: { type: 'string', default: 'trace-1' } },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      active: { type: 'boolean', default: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    expect(plan.operations[0]).toMatchObject({
      name: 'Get user',
      method: 'GET',
      url: 'https://staging.example.com/api/users/:userId?expand=teams',
      pathParams: 'userId:42 // User id',
      searchParams: 'expand:teams',
      headers: 'x-trace-id:trace-1',
      bodyType: 'raw',
      rawType: 'json',
      auth: { type: 'bearer', token: '' },
    })
    expect(plan.operations[0]?.body).toBe('{\n  "active": true\n}')
    expect(plan.warnings.map(warning => warning.code)).toContain('multiple-servers-first-used')
  })

  it('warns for unsupported methods, content types, security schemes, cookie params, callbacks, and webhooks', () => {
    const analysis = analyzeOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Warnings API' },
      webhooks: {
        incoming: {},
      },
      components: {
        securitySchemes: {
          oauthAuth: { type: 'oauth2' },
        },
      },
      paths: {
        '/events': {
          trace: {
            summary: 'Trace event',
          },
          post: {
            summary: 'Create event',
            callbacks: { onEvent: {} },
            parameters: [{ name: 'session', in: 'cookie', schema: { type: 'string' } }],
            security: [{ oauthAuth: [] }],
            requestBody: {
              content: {
                'application/xml': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
    })

    expect(analysis.requestCount).toBe(1)
    expect(analysis.warnings.map(warning => warning.code)).toEqual(
      expect.arrayContaining([
        'webhooks-ignored',
        'callbacks-ignored',
        'unsupported-http-method',
        'unsupported-content-type',
        'unsupported-security-scheme',
        'unsupported-parameter-location',
      ])
    )
  })
})
