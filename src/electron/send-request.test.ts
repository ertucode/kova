import { describe, expect, it } from 'vitest'
import type { HttpAuth } from '../common/Auth.js'
import type { PreparedHttpRequest } from './http-request-runtime.js'
import { applyScriptCallRequestOverrides } from './send-request.js'

describe('applyScriptCallRequestOverrides', () => {
  it('preserves prepared values when overrides are omitted', () => {
    const result = applyScriptCallRequestOverrides({
      preparedRequest: createPreparedRequest(),
      overrides: undefined,
    })

    expect(result).toEqual({
      success: true,
      data: {
        method: 'POST',
        url: 'https://example.com',
        headers: expect.any(Headers),
        requestBody: { body: 'base-body', preview: 'base-body' },
      },
    })

    if (!result.success) {
      throw new Error('Expected overrides to succeed')
    }

    expect(Array.from(result.data.headers.entries())).toEqual([
      ['content-type', 'application/json'],
      ['x-base', '1'],
    ])
  })

  it('treats present body and headers overrides differently from omission', () => {
    const result = applyScriptCallRequestOverrides({
      preparedRequest: createPreparedRequest(),
      overrides: {
        headers: {},
        body: undefined,
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected overrides to succeed')
    }

    expect(Array.from(result.data.headers.entries())).toEqual([])
    expect(result.data.requestBody).toEqual({ body: undefined, preview: '' })
  })

  it('replaces the prepared url when provided', () => {
    const result = applyScriptCallRequestOverrides({
      preparedRequest: createPreparedRequest(),
      overrides: {
        url: ' https://override.example.com/path?x=1 ',
      },
    })

    expect(result).toEqual({
      success: true,
      data: {
        method: 'POST',
        url: 'https://override.example.com/path?x=1',
        headers: expect.any(Headers),
        requestBody: { body: 'base-body', preview: 'base-body' },
      },
    })
  })

  it('rejects an invalid override url', () => {
    const result = applyScriptCallRequestOverrides({
      preparedRequest: createPreparedRequest(),
      overrides: {
        url: 'not a url',
      },
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected invalid url override to fail')
    }

    expect(result.error.type).toBe('message')
    if (result.error.type !== 'message') {
      throw new Error('Expected invalid url override to return a message error')
    }

    expect(result.error.message).toBe('callRequest override url is invalid')
  })

  it('replaces the prepared method when provided', () => {
    const result = applyScriptCallRequestOverrides({
      preparedRequest: createPreparedRequest(),
      overrides: {
        method: 'PATCH',
      },
    })

    expect(result).toEqual({
      success: true,
      data: {
        method: 'PATCH',
        url: 'https://example.com',
        headers: expect.any(Headers),
        requestBody: { body: 'base-body', preview: 'base-body' },
      },
    })
  })
})

function createPreparedRequest(): PreparedHttpRequest {
  return {
    requestId: 'request-1',
    requestName: 'Test Request',
    runtime: {
      request: {
        method: 'POST',
        url: 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' as const },
        headers: 'content-type: application/json\nx-base: 1',
        body: 'base-body',
        bodyType: 'raw' as const,
        rawType: 'text' as const,
      },
      requestScope: new Map(),
      getResolvedVariables: () => ({}),
      getRequestScopeValues: () => ({}),
      getUpdatedEnvironments: () => [],
      getConsoleEntries: () => [],
      resolveTemplateExpressions: async (value: string) => value,
      resolveHttpAuthTemplateExpressions: async (auth: HttpAuth) => auth,
      resolveRequestTemplateExpressions: async () => {},
      runPreRequestScripts: async () => [],
      runPostRequestScripts: async () => [],
    },
    variables: {},
    method: 'POST' as const,
    url: 'https://example.com',
    headers: new Headers({ 'content-type': 'application/json', 'x-base': '1' }),
    resolvedBody: { kind: 'raw' as const, value: 'base-body' },
    requestBody: {
      body: 'base-body',
      preview: 'base-body',
    },
    postRequestScriptSources: [],
  }
}
