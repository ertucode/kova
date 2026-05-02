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

  it('shares active global shared script declarations with request scripts', async () => {
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

    expect(postRequestErrors).toEqual([])
    expect(hiddenToastIds).toEqual(['loading-toast'])
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
        makeRequest: async path => {
          requestedPaths.push(path)
        },
      },
    })

    const errors = await runtime.runPostRequestScripts(
      [
        {
          name: 'Request: Test',
          script: "await makeRequest(['Auth', 'Refresh Token'])",
        },
      ],
      {
        status: 401,
        statusText: 'Unauthorized',
        headers: '',
        body: { type: 'text', data: '' },
      }
    )

    expect(errors).toEqual([])
    expect(requestedPaths).toEqual([['Auth', 'Refresh Token']])
  })
})
