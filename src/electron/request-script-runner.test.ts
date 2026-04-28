import { describe, expect, it } from 'vitest'
import { createRequestScriptRuntime } from './request-script-runner.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

describe('createRequestScriptRuntime', () => {
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
})
