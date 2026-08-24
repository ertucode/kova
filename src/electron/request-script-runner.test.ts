import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { createRequestScriptRuntime } from './request-script-runner.js'
import * as environmentDb from './db/environments.js'
import * as requestExamplesDb from './db/request-examples.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('createRequestScriptRuntime', () => {
  it('exposes request metadata to scripts', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: true,
        retryCount: 2,
      },
      environments: [],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "scope.set('isRetry', String(requestMetadata.isRetry))\nscope.set('retryCount', String(requestMetadata.retryCount))\nscope.set('currentRuntime', requestMetadata.currentRuntime)\nscope.set('sourceRuntime', requestMetadata.sourceRuntime)",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues()).toEqual({
      isRetry: 'true',
      retryCount: '2',
      currentRuntime: 'pre-request',
      sourceRuntime: 'request-editor',
    })
  })

  it('exposes draft url separately from the resolved url', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: '{{host}}/users/:userId',
        pathParams: 'userId:42 // Target user',
        searchParams: 'expand:true',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [
        {
          id: 'env-1',
          name: 'Default',
          variables: 'host:https://example.com',
          color: null,
          warnOnRequest: false,
          position: 0,
          priority: 0,
          createdAt: 1,
          deletedAt: null,
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "scope.set('draftUrl', request.url)\nscope.set('resolvedUrl', request.resolveUrl())\nscope.set('pathParams', JSON.stringify(request.pathParams))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues()).toEqual({
      draftUrl: '{{host}}/users/:userId',
      resolvedUrl: 'https://example.com/users/42?expand=true',
      pathParams: JSON.stringify([{ key: 'userId', value: '42', enabled: true, description: 'Target user' }]),
    })
  })

  it('lets scripts replace path params with structured rows', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com/users/:userId',
        pathParams: 'userId:1',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "request.pathParams = [{ key: 'userId', value: '99', enabled: true, description: 'Updated user' }]\nscope.set('resolvedUrl', request.resolveUrl())\nscope.set('pathParams', JSON.stringify(request.pathParams))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.request.pathParams).toBe('userId:99 // Updated user')
    expect(runtime.getRequestScopeValues()).toEqual({
      resolvedUrl: 'https://example.com/users/99',
      pathParams: JSON.stringify([{ key: 'userId', value: '99', enabled: true, description: 'Updated user' }]),
    })
  })

  it('lets scripts mutate individual path params in place', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com/users/:userId',
        pathParams: 'userId:1 // Original user',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "request.pathParams[0].value = '321'\nrequest.pathParams[0].description = 'Mutated user'\nscope.set('resolvedUrl', request.resolveUrl())\nscope.set('pathParams', JSON.stringify(request.pathParams))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.request.pathParams).toBe('userId:321 // Mutated user')
    expect(runtime.getRequestScopeValues()).toEqual({
      resolvedUrl: 'https://example.com/users/321',
      pathParams: JSON.stringify([{ key: 'userId', value: '321', enabled: true, description: 'Mutated user' }]),
    })
  })

  it('shares active global shared script declarations with request scripts', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        requestId: 'request-1',
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      sharedScripts: [
        {
          id: 'shared-global-1',
          scopeType: 'workspace',
          scopeId: null,
          name: 'authGlobals',
          kind: 'global',
          targets: ['pre-request'],
          isActive: true,
          code: "function setAuthHeader() { request.headers.set('Authorization', 'Bearer shared-token') }",
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "setAuthHeader(); scope.set('authorization', request.headers.get('Authorization') ?? '')",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().authorization).toBe('Bearer shared-token')
  })

  it('loads shared modules through requireScript', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      sharedScripts: [
        {
          id: 'shared-module-1',
          scopeType: 'workspace',
          scopeId: null,
          name: 'authModule',
          kind: 'module',
          targets: ['pre-request'],
          isActive: true,
          code: "export function setAuthHeader() { request.headers.set('Authorization', 'Bearer module-token') }",
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "requireScript('authModule').setAuthHeader(); scope.set('authorization', request.headers.get('Authorization') ?? '')",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().authorization).toBe('Bearer module-token')
  })

  it('loads installed packages through loadPackage', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      scriptPackages: [
        {
          packageName: 'lodash',
          packageVersion: '4.17.21',
          typesPackageName: '@types/lodash',
          typesPackageVersion: '4.17.20',
          cacheDirectory: path.resolve('.'),
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "const { camelCase } = loadPackage('lodash@4.17.21'); scope.set('value', camelCase('hello world'))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().value).toBe('helloWorld')
  })

  it('loads installed packages through versioned import syntax', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      scriptPackages: [
        {
          packageName: 'lodash',
          packageVersion: '4.17.21',
          typesPackageName: '@types/lodash',
          typesPackageVersion: '4.17.20',
          cacheDirectory: path.resolve('.'),
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "import { kebabCase } from 'lodash@4.17.21'\nscope.set('value', kebabCase('Hello World'))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().value).toBe('hello-world')
  })

  it('loads CommonJS default imports from installed packages', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      scriptPackages: [
        {
          packageName: 'lodash',
          packageVersion: '4.17.21',
          typesPackageName: '@types/lodash',
          typesPackageVersion: '4.17.20',
          cacheDirectory: path.resolve('.'),
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "import _ from 'lodash@4.17.21'\nscope.set('value', _.isArray([]).toString())",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().value).toBe('true')
  })

  it('loads shared modules inside template expressions with pre-request semantics', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      sharedScripts: [
        {
          id: 'shared-module-template-1',
          scopeType: 'workspace',
          scopeId: null,
          name: 'traceModule',
          kind: 'module',
          targets: ['pre-request'],
          isActive: true,
          code: "export function nextTraceId() { const traceId = crypto.randomUUID(); scope.set('traceId', traceId); return traceId }",
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    })

    const result = await runtime.resolveTemplateExpressions('{{$requireScript("traceModule").nextTraceId()}}', 'Request Body')

    expect(result).toMatch(UUID_PATTERN)
    expect(runtime.getRequestScopeValues().traceId).toBe(result)
  })

  it('loads installed packages inside template expressions', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      scriptPackages: [
        {
          packageName: 'lodash',
          packageVersion: '4.17.21',
          typesPackageName: '@types/lodash',
          typesPackageVersion: '4.17.20',
          cacheDirectory: path.resolve('.'),
        },
      ],
    })

    const result = await runtime.resolveTemplateExpressions('{{$loadPackage("lodash").isArray([])}}', 'Request Body')

    expect(result).toBe('true')
  })

  it('only exposes pre-request shared modules to template expressions', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      sharedScripts: [
        {
          id: 'shared-module-template-2',
          scopeType: 'workspace',
          scopeId: null,
          name: 'postOnlyModule',
          kind: 'module',
          targets: ['post-request'],
          isActive: true,
          code: 'export const answer = 42',
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    })

    await expect(
      runtime.resolveTemplateExpressions('{{$requireScript("postOnlyModule").answer}}', 'Request Body')
    ).rejects.toThrow('Shared script module postOnlyModule was not found')
  })

  it('rejects shared modules without explicit exports', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      sharedScripts: [
        {
          id: 'shared-module-2',
          scopeType: 'workspace',
          scopeId: null,
          name: 'brokenModule',
          kind: 'module',
          targets: ['pre-request'],
          isActive: true,
          code: "function setAuthHeader() { request.headers.set('Authorization', 'Bearer module-token') }",
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        },
      ],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "requireScript('brokenModule')",
      },
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('must use explicit exports')
  })

  it('resolves template expressions in request field order with shared scope', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com/{{$const id = crypto.randomUUID(); scope.set("traceId", id); return id}}',
        pathParams: '',
        searchParams: 'trace:{{$scope.get("traceId")}}',
        auth: { type: 'noauth' },
        headers: 'x-trace:{{$scope.get("traceId")}}',
        body: '{"traceId":"{{$scope.get("traceId")}}"}',
        bodyType: 'raw',
        rawType: 'json',
      },
      environments: [],
    })

    await runtime.resolveRequestTemplateExpressions()

    const traceId = runtime.getRequestScopeValues().traceId
    expect(traceId).toMatch(UUID_PATTERN)
    expect(runtime.request.url).toBe(`https://example.com/${traceId}`)
    expect(runtime.request.searchParams).toBe(`trace:${traceId}`)
    expect(runtime.request.headers).toBe(`x-trace:${traceId}`)
    expect(runtime.request.body).toBe(`{"traceId":"${traceId}"}`)
  })

  it('runs pre-request scripts after template expressions resolve', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '{{$crypto.randomUUID()}}',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
    })

    await runtime.resolveRequestTemplateExpressions()
    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "scope.set('resolvedBody', request.body)",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.request.body).toMatch(UUID_PATTERN)
    expect(runtime.getRequestScopeValues().resolvedBody).toBe(runtime.request.body)
  })

  it('returns the last expression value from statement-based template scripts', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '{{$const a = 2; a.toString()}}',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
    })

    await runtime.resolveRequestTemplateExpressions()

    expect(runtime.request.body).toBe('2')
  })

  it('calls zero-argument function results from template expressions', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '{{$crypto.randomUUID}}',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
    })

    await runtime.resolveRequestTemplateExpressions()

    expect(runtime.request.body).toMatch(UUID_PATTERN)
  })

  it('stringifies cross-context Date results as ISO strings', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '{{$const b = new Date("2026-04-29T12:34:56.000Z"); b}}',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
    })

    await runtime.resolveRequestTemplateExpressions()

    expect(runtime.request.body).toBe('2026-04-29T12:34:56.000Z')
  })

  it('leaves escaped template expressions untouched', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const result = await runtime.resolveTemplateExpressions('\\{{$crypto.randomUUID()}}', 'Request Body')

    expect(result).toBe('{{$crypto.randomUUID()}}')
  })

  it('shows script toasts and returns the generated id', async () => {
    const shownToasts: Array<Record<string, unknown>> = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      toast: {
        show: toast => shownToasts.push(toast),
        hide: () => undefined,
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "const toastId = toast.show({ severity: 'info', title: 'Sending', message: 'Preparing request', timeout: 2500, location: 'bottom-right' })\nscope.set('toastId', toastId)",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().toastId).toMatch(UUID_PATTERN)
    expect(shownToasts).toEqual([
      {
        id: runtime.getRequestScopeValues().toastId,
        severity: 'info',
        title: 'Sending',
        message: 'Preparing request',
        timeout: 2500,
        location: 'bottom-right',
      },
    ])
  })

  it('hides a previously shown script toast', async () => {
    const hiddenToastIds: string[] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      toast: {
        show: () => undefined,
        hide: id => hiddenToastIds.push(id),
      },
    })

    const preRequestErrors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "scope.set('toastId', 'loading-toast')",
      },
    ])

    expect(preRequestErrors).toEqual([])

    const postRequestErrors = await runtime.runPostRequestScripts(
      [
        {
          name: 'Request: Test',
          script: "const toastId = scope.get('toastId')\nif (toastId) {\n  toast.hide(toastId)\n}",
        },
      ],
      {
        status: 200,
        statusText: 'OK',
        headers: '',
        body: { type: 'text', data: '' },
      }
    )

  expect(postRequestErrors).toEqual({ scriptErrors: [], retryRequested: false })
  expect(hiddenToastIds).toEqual(['loading-toast'])
})

it('runs test scripts with kv.test and persists environment updates', async () => {
  const navigatedPaths: string[][] = []
  const updateEnvironmentVariablesSpy = vi.spyOn(environmentDb, 'updateEnvironmentVariables').mockImplementation(async input => ({
    id: input.id,
    name: 'Default',
    variables: input.variables,
    color: null,
    warnOnRequest: false,
    position: 0,
    priority: 0,
    createdAt: 1,
    deletedAt: null,
  }))
  try {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [
        {
          id: 'env-1',
          name: 'Default',
          variables: '',
          color: null,
          warnOnRequest: false,
          position: 0,
          priority: 0,
          createdAt: 1,
          deletedAt: null,
        },
      ],
      makeRequest: {
        navigateAndCallRequest: async path => {
          navigatedPaths.push(path)
        },
        callRequest: async () => ({
          status: 200,
          statusText: 'OK',
          headers: '',
          body: { type: 'text', data: '' },
        }),
      },
    })

    const result = await runtime.runTestScripts(
      [
        {
          name: 'Request: Tests',
          script:
            "kv.test.describe('suite', () => {\n  kv.test.beforeEach(() => {\n    scope.set('before', '1')\n  })\n\n  kv.test.it('updates env', async () => {\n    env.set('token', 'abc')\n    await navigateAndCallRequest(['Auth', 'Refresh Token'])\n  })\n\n  kv.test.skip('ignored', () => {\n    env.set('token', 'skip')\n  })\n})",
        },
      ],
      {
        status: 200,
        statusText: 'OK',
        headers: '',
        body: { type: 'text', data: '' },
      }
    )

    expect(result.scriptErrors).toEqual([])
    expect(result.registeredTests).toBe(2)
    expect(result.testRun?.passedCount).toBe(1)
    expect(result.testRun?.skippedCount).toBe(1)
    expect(navigatedPaths).toEqual([['Auth', 'Refresh Token']])
    expect(runtime.getRequestScopeValues().before).toBe('1')
    expect(runtime.getUpdatedEnvironments()).toEqual([
      {
        id: 'env-1',
        name: 'Default',
        variables: 'token:abc',
        color: null,
        warnOnRequest: false,
        position: 0,
        priority: 0,
        createdAt: 1,
        deletedAt: null,
      },
    ])
    expect(updateEnvironmentVariablesSpy).toHaveBeenCalledWith({ id: 'env-1', variables: 'token:abc' })
  } finally {
    updateEnvironmentVariablesSpy.mockRestore()
  }
})

it('does not expose retryRequest in test scripts', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      requestId: 'request-1',
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })

  const result = await runtime.runTestScripts(
    [
      {
        name: 'Request: Tests',
        script: 'retryRequest()',
      },
    ],
    {
      status: 200,
      statusText: 'OK',
      headers: '',
      body: { type: 'text', data: '' },
    }
  )

  expect(result.registeredTests).toBe(0)
  expect(result.testRun).toBeNull()
  expect(result.scriptErrors).toHaveLength(1)
  expect(result.scriptErrors[0]?.phase).toBe('test')
  expect(result.scriptErrors[0]?.message).toContain('retryRequest is not defined')
})

  it('supports only and async example matching in test scripts', async () => {
  const listExamplesSpy = vi.spyOn(requestExamplesDb, 'listRequestExamplesByRequestIds').mockResolvedValue([
    {
      id: 'example-1',
      requestId: 'request-1',
      name: 'success',
      position: 0,
      requestHeaders: '',
      requestBody: '',
      requestBodyType: 'none',
      requestRawType: 'json',
      responseStatus: 200,
      responseStatusText: 'OK',
      responseHeaders: 'content-type: application/json',
      responseBody: '{"ok":true}',
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
  ])

  try {
    const runtime = createRequestScriptRuntime({
      request: {
        requestId: 'request-1',
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const result = await runtime.runTestScripts(
      [
        {
          name: 'Request: Tests',
          script:
            "kv.test.it('plain', () => { kv.test.fail('should be skipped') })\nkv.test.only('matches example', async () => {\n  const example = await kv.test.example('success')\n  kv.test.expect(example.response.status).toBe(200)\n  await kv.test.expectResponse().toMatchExample('success')\n})",
        },
      ],
      {
        status: 200,
        statusText: 'OK',
        headers: 'content-type: application/json',
        body: { type: 'json', data: { ok: true } },
        rawBody: '{"ok":true}',
      }
    )

    expect(result.scriptErrors).toEqual([])
    expect(result.registeredTests).toBe(2)
    expect(result.testRun?.passedCount).toBe(1)
    expect(result.testRun?.skippedCount).toBe(1)
    expect(result.testRun?.failedCount).toBe(0)
    expect(listExamplesSpy).toHaveBeenCalledWith(['request-1'])
  } finally {
    listExamplesSpy.mockRestore()
  }
})

it('supports richer kv.test.expect matchers', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      requestId: 'request-1',
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })

  const result = await runtime.runTestScripts(
    [
      {
        name: 'Request: Tests',
        script:
          "kv.test.it('rich matchers', () => {\n  kv.test.expect({ user: { id: 1, roles: ['admin', 'editor'] } }).toMatchObject({ user: { id: 1 } })\n  kv.test.expect([{ id: 1 }, { id: 2 }]).toContain({ id: 2 })\n  kv.test.expect(200).toBeGreaterThan(199)\n  kv.test.expect(200).toBeGreaterThanOrEqual(200)\n  kv.test.expect(200).toBeLessThan(201)\n  kv.test.expect(200).toBeLessThanOrEqual(200)\n  kv.test.expect('application/json').toStartWith('application/')\n  kv.test.expect('application/json').toEndWith('json')\n  kv.test.expect('application/json').not.toContain('xml')\n  kv.test.expect(undefined).not.toBeDefined()\n  kv.test.expect('Ada').toBeDefined()\n  kv.test.expect('Ada').not.toBeUndefined()\n  kv.test.expect('Ada').not.toMatchSchema(z.number())\n  const parsed = kv.test.expect(response.body.type === 'json' ? response.body.data : null).toMatchSchema(z.object({ ok: z.boolean(), count: z.number() }))\n  kv.test.expect(parsed.count).not.toBe(0)\n})",
      },
    ],
    {
      status: 200,
      statusText: 'OK',
      headers: 'content-type: application/json',
      body: { type: 'json', data: { ok: true, count: 2 } },
      rawBody: '{"ok":true,"count":2}',
    }
  )

  expect(result.scriptErrors).toEqual([])
  expect(result.registeredTests).toBe(1)
  expect(result.testRun?.passedCount).toBe(1)
  expect(result.testRun?.failedCount).toBe(0)
})

it('records negated matcher failures', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      requestId: 'request-1',
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })

  const result = await runtime.runTestScripts(
    [
      {
        name: 'Request: Tests',
        script: "kv.test.it('fails', () => { kv.test.expect('abc').not.toContain('a') })",
      },
    ],
    {
      status: 200,
      statusText: 'OK',
      headers: '',
      body: { type: 'text', data: '' },
    }
  )

  expect(result.scriptErrors).toEqual([])
  expect(result.testRun?.failedCount).toBe(1)
  expect(result.testRun?.suites[0]?.tests[0]?.failures[0]).toMatchObject({
    matcherName: 'not.toContain',
    message: "Expected 'abc' not to contain 'a'",
    expected: 'a',
    actual: 'abc',
  })
})

it('rejects non-string substring assertions for string values', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      requestId: 'request-1',
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })

  const result = await runtime.runTestScripts(
    [
      {
        name: 'Request: Tests',
        script: "kv.test.it('fails', () => { kv.test.expect('abc').toContain(123) })",
      },
    ],
    {
      status: 200,
      statusText: 'OK',
      headers: '',
      body: { type: 'text', data: '' },
    }
  )

  expect(result.scriptErrors).toEqual([])
  expect(result.testRun?.failedCount).toBe(1)
  expect(result.testRun?.suites[0]?.tests[0]?.failures[0]).toMatchObject({
    matcherName: 'toContain',
    message: 'Expected 123 to be a string',
    expected: 123,
    actual: 'abc',
  })
})

  it('allows post-request scripts to mutate response headers', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })
  const response = {
    status: 200,
    statusText: 'OK',
    headers: 'content-type: application/json\nset-cookie: session=old',
    body: { type: 'json', data: { ok: true } } as const,
  }

  const errors = await runtime.runPostRequestScripts(
    [
      {
        name: 'Request: Test',
        script:
          "response.headers.set('x-scripted', '1')\nresponse.headers.set('set-cookie', 'session=new; Path=/')\nresponse.headers.delete('content-type')\nscope.set('header', response.headers.get('x-scripted') ?? '')",
      },
    ],
    response
  )

  expect(errors).toEqual({ scriptErrors: [], retryRequested: false })
  expect(runtime.getRequestScopeValues().header).toBe('1')
  expect(response.headers).toBe('set-cookie: session=new; Path=/\nx-scripted: 1')
})

it('parses and rewrites response cookies from the header helper', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })
  const response = {
    status: 200,
    statusText: 'OK',
    headers:
      'set-cookie: cookiesession1=skip; Path=/; HttpOnly, session=keep; Path=/; Secure; SameSite=None',
    body: { type: 'text', data: '' } as const,
  }

  const errors = await runtime.runPostRequestScripts(
    [
      {
        name: 'Request: Test',
        script:
          "if (response.headers.get('set-cookie')) {\n  const c = cookies.parse(response.headers.get('set-cookie'))\n  const filtered = c.filter(c => c.name !== 'cookiesession1')\n  response.headers.set('set-cookie', cookies.stringify(filtered))\n}\n\nif (response.hasCookies()) {\n  const c = response.parseCookies()\n  const filtered = c.filter(c => c.name !== 'cookiesession1')\n  response.headers.set('set-cookie', cookies.stringify(filtered))\n}",
      },
    ],
    response
  )

  expect(errors).toEqual({ scriptErrors: [], retryRequested: false })
  expect(response.headers).toBe('set-cookie: session=keep; Path=/; Secure; SameSite=None')
})

it('allows post-request scripts to inspect the response and request a retry', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      method: 'POST',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })
  const response = {
    status: 401,
    statusText: 'Unauthorized',
    headers: 'content-type: application/json',
    body: { type: 'json', data: { code: 'expired' } } as const,
  }

  const result = await runtime.runPostRequestScripts(
    [
      {
        name: 'Request: Test',
        script:
          "if (response.body.type !== 'json') throw new Error('Expected JSON body')\nscope.set('code', String(Reflect.get(response.body.data, 'code')))\nresponse.headers.set('x-retry', '1')\nretryRequest()",
      },
      {
        name: 'Folder: Should Not Run',
        script: "scope.set('afterRetry', 'should-not-run')",
      },
    ],
    response
  )

  expect(result).toEqual({ scriptErrors: [], retryRequested: true })
  expect(runtime.getRequestScopeValues()).toEqual({ code: 'expired' })
  expect(response.headers).toBe('content-type: application/json\nx-retry: 1')
})

it('preserves token refresher ids when resolving auth template expressions', async () => {
  const runtime = createRequestScriptRuntime({
    request: {
      method: 'GET',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      headers: '',
      body: '',
      bodyType: 'none',
      rawType: 'text',
    },
    environments: [],
  })

  await expect(
    runtime.resolveHttpAuthTemplateExpressions(
      { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
      'Folder Auth: Protected'
    )
  ).resolves.toEqual({
    type: 'bearer',
    token: '{{token}}',
    tokenRefreshRequestId: 'request-refresh',
  })
})

  it('returns the prompted text value to the script', async () => {
    const promptedOptions: Array<Record<string, unknown>> = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async options => {
          promptedOptions.push(options)
          return 'Ada'
        },
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "const name = await prompt.text({ title: 'Your name', message: 'Needed for the request', defaultValue: 'Grace' })\nif (name) {\n  scope.set('name', name)\n}",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().name).toBe('Ada')
    expect(promptedOptions).toEqual([
      {
        title: 'Your name',
        message: 'Needed for the request',
        defaultValue: 'Grace',
      },
    ])
  })

  it('writes to the system clipboard from pre-request scripts', async () => {
    const clipboardWrites: string[] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      clipboard: {
        writeText: value => clipboardWrites.push(value),
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: 'clipboard.write(request.resolveUrl())',
      },
    ])

    expect(errors).toEqual([])
    expect(clipboardWrites).toEqual(['https://example.com'])
  })

  it('writes to the system clipboard from post-request scripts', async () => {
    const clipboardWrites: string[] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      clipboard: {
        writeText: value => clipboardWrites.push(value),
      },
    })

    const errors = await runtime.runPostRequestScripts(
      [
        {
          name: 'Request: Test',
          script:
            "if (response.body.type === 'json' && response.body.data && typeof response.body.data === 'object') {\n  const token = Reflect.get(response.body.data, 'token')\n  if (typeof token === 'string') {\n    clipboard.write(token)\n  }\n}",
        },
      ],
      {
        status: 200,
        statusText: 'OK',
        headers: 'content-type: application/json',
        body: { type: 'json', data: { token: 'secret-token' } },
      }
    )

    expect(errors).toEqual({ scriptErrors: [], retryRequested: false })
    expect(clipboardWrites).toEqual(['secret-token'])
  })

  it('rejects non-string clipboard writes', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: 'clipboard.write(123)',
      },
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('clipboard.write requires a string')
  })

  it('allows prompt.text without a title', async () => {
    const promptedOptions: Array<Record<string, unknown>> = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async options => {
          promptedOptions.push(options)
          return 'Ada'
        },
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "const name = await prompt.text({ message: 'Needed for the request' })\nif (name) {\n  scope.set('name', name)\n}",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().name).toBe('Ada')
    expect(promptedOptions).toEqual([
      {
        message: 'Needed for the request',
      },
    ])
  })

  it('exposes prompt.text inside template expressions', async () => {
    const promptedOptions: Array<Record<string, unknown>> = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async options => {
          promptedOptions.push(options)
          return 'Ada'
        },
      },
    })

    const result = await runtime.resolveTemplateExpressions(
      '{{$await prompt.text({ title: "Your name", defaultValue: "Grace" })}}',
      'Request Body'
    )

    expect(result).toBe('Ada')
    expect(promptedOptions).toEqual([
      {
        title: 'Your name',
        defaultValue: 'Grace',
      },
    ])
  })

  it('does not count prompt wait time against the script timeout', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async () => {
          await new Promise(resolve => setTimeout(resolve, 700))
          return '42'
        },
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "const answer = await prompt.text({ title: 'Answer' })\nif (answer) {\n  scope.set('answer', answer)\n}",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().answer).toBe('42')
  })

  it('returns null when the user cancels a prompt', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async () => null,
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "const answer = await prompt.text({ title: 'Answer' })\nscope.set('wasCancelled', String(answer === null))",
      },
    ])

    expect(errors).toEqual([])
    expect(runtime.getRequestScopeValues().wasCancelled).toBe('true')
  })

  it('passes required to the prompt bridge', async () => {
    const promptedOptions: Array<Record<string, unknown>> = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async options => {
          promptedOptions.push(options)
          return 'Ada'
        },
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "await prompt.text({ title: 'Your name', required: true })",
      },
    ])

    expect(errors).toEqual([])
    expect(promptedOptions).toEqual([
      {
        title: 'Your name',
        required: true,
      },
    ])
  })

  it('throws when a required prompt is submitted blank', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async () => '',
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "await prompt.text({ title: 'Answer', required: true })",
      },
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('prompt.text value is required')
  })

  it('throws when a required prompt is cancelled', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      prompt: {
        text: async () => null,
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script: "await prompt.text({ title: 'Answer', required: true })",
      },
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('prompt.text value is required')
  })

  it('throws a clear error when request.headers.set receives null', async () => {
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Folder: ORTAKAPP',
        script: "request.headers.set('x-device-id', null)",
      },
    ])

    expect(errors).toHaveLength(1)
    expect(errors[0]?.sourceName).toBe('Folder: ORTAKAPP')
    expect(errors[0]?.message).toBe('request.headers.set expected header value to be a string, received null.')
  })

  it('allows post-request scripts to trigger another request by path', async () => {
    const requestedPaths: string[][] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      makeRequest: {
        navigateAndCallRequest: async path => {
          requestedPaths.push(path)
        },
        callRequest: async () => {
          throw new Error('callRequest should not be used in this test')
        },
      },
    })

    const errors = await runtime.runPostRequestScripts(
      [
        {
          name: 'Request: Test',
          script: "await navigateAndCallRequest(['Auth', 'Refresh Token'])",
        },
      ],
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: '',
        body: { type: 'text', data: '' },
      }
    )

    expect(errors).toEqual({ scriptErrors: [], retryRequested: false })
    expect(requestedPaths).toEqual([['Auth', 'Refresh Token']])
  })

  it('allows post-request scripts to call another request and inspect the response', async () => {
    const requestedPaths: string[][] = []
    const requestedOverrides: unknown[] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: [],
      makeRequest: {
        navigateAndCallRequest: async () => {
          throw new Error('navigateAndCallRequest should not be used in this test')
        },
        callRequest: async (path, overrides) => {
          requestedPaths.push(path)
          requestedOverrides.push(overrides)
          return {
            status: 200,
            statusText: 'OK',
            headers: 'content-type: application/json\nx-trace-id: abc123',
            body: { type: 'json', data: { token: 'secret' } },
          }
        },
      },
    })

    const errors = await runtime.runPostRequestScripts(
      [
        {
          name: 'Request: Test',
          script:
            "const refreshResponse = await callRequest(['Auth', 'Refresh Token'])\nif (refreshResponse.status !== 200) throw new Error('Unexpected status')\nif (refreshResponse.headers.get('x-trace-id') !== 'abc123') throw new Error('Missing trace header')\nif (refreshResponse.body.type !== 'json') throw new Error('Expected JSON body')\nconst token = typeof refreshResponse.body.data === 'object' && refreshResponse.body.data !== null ? Reflect.get(refreshResponse.body.data, 'token') : null\nif (token !== 'secret') throw new Error('Missing token')",
        },
      ],
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: '',
        body: { type: 'text', data: '' },
      }
    )

    expect(errors).toEqual({ scriptErrors: [], retryRequested: false })
    expect(requestedPaths).toEqual([['Auth', 'Refresh Token']])
    expect(requestedOverrides).toEqual([undefined])
  })

  it('allows pre-request scripts to call another request with overrides', async () => {
    const requestedPaths: string[][] = []
    const requestedOverrides: unknown[] = []
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        headers: 'x-base: original',
        body: 'payload',
        bodyType: 'raw',
        rawType: 'text',
      },
      environments: [],
      makeRequest: {
        navigateAndCallRequest: async () => {
          throw new Error('navigateAndCallRequest should not be used in this test')
        },
        callRequest: async (path, overrides) => {
          requestedPaths.push(path)
          requestedOverrides.push(overrides)
          return {
            status: 204,
            statusText: 'No Content',
            headers: '',
            body: { type: 'text', data: '' },
          }
        },
      },
    })

    const errors = await runtime.runPreRequestScripts([
      {
        name: 'Request: Test',
        script:
          "const refreshResponse = await callRequest(['Auth', 'Refresh Token'], { headers: {}, body: undefined })\nif (refreshResponse.status !== 204) throw new Error('Unexpected status')",
      },
    ])

    expect(errors).toEqual([])
    expect(requestedPaths).toEqual([['Auth', 'Refresh Token']])
    expect(requestedOverrides).toEqual([{ headers: {}, body: undefined }])
  })
})
