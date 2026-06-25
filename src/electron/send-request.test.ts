import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HttpAuth } from '../common/Auth.js'
import { Result } from '../common/Result.js'
import * as cookieDb from './db/cookies.js'
import * as requestDb from './db/requests.js'
import * as genericEvents from './generic-events.js'
import * as httpRequestRuntime from './http-request-runtime.js'
import type { PreparedHttpRequest } from './http-request-runtime.js'
import { applyScriptCallRequestOverrides, sendRequest } from './send-request.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

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

  it('emits a frontend retry event when a post-request script calls retryRequest', async () => {
    const preparedRequest = createPreparedRequest()
    const postRequestSpy = vi.fn(async (_sources, response) => {
      expect(response.body).toEqual({ type: 'json', data: { retry: true } })
      return { scriptErrors: [], retryRequested: true }
    })
    preparedRequest.runtime.runPostRequestScripts = postRequestSpy

    const emitGenericEventSpy = vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockResolvedValue(Result.Success(preparedRequest))
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)

    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ retry: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchSpy)

    const result = await sendRequest({
      requestId: 'request-1',
      method: 'POST',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      preRequestScript: '',
      postRequestScript: '',
      testScript: '',
      headers: '',
      body: 'base-body',
      bodyType: 'raw',
      rawType: 'text',
      activeEnvironmentIds: [],
      saveToHistory: false,
      historyKeepLast: 10,
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: false,
        retryCount: 0,
      },
    })

    expect(result.success).toBe(true)
    expect(postRequestSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(emitGenericEventSpy).toHaveBeenCalledWith({
      type: 'retry-request',
      requestId: 'request-1',
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: true,
        retryCount: 1,
      },
    })
  })

  it('does not emit a retry event for script-triggered requests', async () => {
    const preparedRequest = createPreparedRequest()
    preparedRequest.runtime.runPostRequestScripts = async () => ({ scriptErrors: [], retryRequested: true })

    const emitGenericEventSpy = vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockResolvedValue(Result.Success(preparedRequest))
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('ok', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        })
      )
    )

    const result = await sendRequest({
      requestId: 'request-1',
      method: 'POST',
      url: 'https://example.com',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      preRequestScript: '',
      postRequestScript: '',
      testScript: '',
      headers: '',
      body: 'base-body',
      bodyType: 'raw',
      rawType: 'text',
      activeEnvironmentIds: [],
      saveToHistory: false,
      historyKeepLast: 10,
      requestMetadata: {
        sourceRuntime: 'call-request',
        isRetry: false,
        retryCount: 0,
      },
    })

    expect(result.success).toBe(true)
    expect(emitGenericEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'retry-request',
      })
    )
  })

  it('emits a retry event after the token refresh request succeeds on 401', async () => {
    const preparedRequests = new Map([
      [
        'request-1',
        createPreparedRequest({
          requestId: 'request-1',
          requestName: 'Protected Request',
          resolvedAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
          runtimeRequestAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
        }),
      ],
      [
        'request-refresh',
        createPreparedRequest({
          requestId: 'request-refresh',
          requestName: 'Refresh Token',
          url: 'https://example.com/auth/token',
          resolvedAuth: { type: 'noauth' },
          runtimeRequestAuth: { type: 'noauth' },
        }),
      ],
    ])

    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockImplementation(async input => {
      const preparedRequest = preparedRequests.get(input.requestId)
      if (!preparedRequest) {
        throw new Error(`Unexpected request id: ${input.requestId}`)
      }

      return Result.Success(preparedRequest)
    })
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    vi.spyOn(requestDb, 'getRequest').mockImplementation(async ({ id }) => {
      if (id !== 'request-refresh') {
        throw new Error(`Unexpected getRequest id: ${id}`)
      }

      return Result.Success({
        id: 'request-refresh',
        name: 'Refresh Token',
        requestType: 'http',
        method: 'POST',
        url: 'https://example.com/auth/token',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        preRequestScript: '',
        postRequestScript: '',
        testScript: '',
        responseVisualizer: '',
        responseTableAccessor: '',
        preferredResponseBodyView: 'raw',
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('expired', {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response('token', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response('ok', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
          })
        )
    )

    const emitGenericEventSpy = vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)

    const result = await sendRequest({
      requestId: 'request-1',
      method: 'POST',
      url: 'https://example.com/protected',
      pathParams: '',
      searchParams: '',
      auth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
      preRequestScript: '',
      postRequestScript: '',
      testScript: '',
      headers: '',
      body: 'base-body',
      bodyType: 'raw',
      rawType: 'text',
      activeEnvironmentIds: [],
      saveToHistory: false,
      historyKeepLast: 10,
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: false,
        retryCount: 0,
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected token refresh flow to return the original response')
    }

    expect(result.data.status).toBe(401)
    expect(emitGenericEventSpy).toHaveBeenCalledWith({
      type: 'retry-request',
      requestId: 'request-1',
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: true,
        retryCount: 1,
      },
    })
    expect(requestDb.getRequest).toHaveBeenCalledWith({ id: 'request-refresh' })
    expect(httpRequestRuntime.prepareHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the token refresh request fails', async () => {
    const preparedRequests = new Map([
      [
        'request-1',
        createPreparedRequest({
          requestId: 'request-1',
          requestName: 'Protected Request',
          resolvedAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
          runtimeRequestAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
        }),
      ],
      [
        'request-refresh',
        createPreparedRequest({
          requestId: 'request-refresh',
          requestName: 'Refresh Token',
          url: 'https://example.com/auth/token',
          resolvedAuth: { type: 'noauth' },
          runtimeRequestAuth: { type: 'noauth' },
        }),
      ],
    ])

    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockImplementation(async input => {
      const preparedRequest = preparedRequests.get(input.requestId)
      if (!preparedRequest) {
        throw new Error(`Unexpected request id: ${input.requestId}`)
      }

      return Result.Success(preparedRequest)
    })
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(requestDb, 'getRequest').mockResolvedValue(
      Result.Success({
        id: 'request-refresh',
        name: 'Refresh Token',
        requestType: 'http',
        method: 'POST',
        url: 'https://example.com/auth/token',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        preRequestScript: '',
        postRequestScript: '',
        testScript: '',
        responseVisualizer: '',
        responseTableAccessor: '',
        preferredResponseBodyView: 'raw',
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('expired', {
            status: 403,
            statusText: 'Forbidden',
            headers: { 'content-type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response('still expired', {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'text/plain' },
          })
        )
    )

    const result = await sendRequest({
      requestId: 'request-1',
      method: 'POST',
      url: 'https://example.com/protected',
      pathParams: '',
      searchParams: '',
      auth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
      preRequestScript: '',
      postRequestScript: '',
      testScript: '',
      headers: '',
      body: 'base-body',
      bodyType: 'raw',
      rawType: 'text',
      activeEnvironmentIds: [],
      saveToHistory: false,
      historyKeepLast: 10,
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: false,
        retryCount: 0,
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected original response to be returned')
    }

    expect(result.data.status).toBe(403)
    expect(httpRequestRuntime.prepareHttpRequest).toHaveBeenCalledTimes(2)
  })

  it('emits a retry event when the token refresh request succeeds with another 2xx status', async () => {
    const preparedRequests = new Map([
      [
        'request-1',
        createPreparedRequest({
          requestId: 'request-1',
          requestName: 'Protected Request',
          resolvedAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
          runtimeRequestAuth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
        }),
      ],
      [
        'request-refresh',
        createPreparedRequest({
          requestId: 'request-refresh',
          requestName: 'Refresh Token',
          url: 'https://example.com/auth/token',
          resolvedAuth: { type: 'noauth' },
          runtimeRequestAuth: { type: 'noauth' },
        }),
      ],
    ])

    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockImplementation(async input => {
      const preparedRequest = preparedRequests.get(input.requestId)
      if (!preparedRequest) {
        throw new Error(`Unexpected request id: ${input.requestId}`)
      }

      return Result.Success(preparedRequest)
    })
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(requestDb, 'getRequest').mockResolvedValue(
      Result.Success({
        id: 'request-refresh',
        name: 'Refresh Token',
        requestType: 'http',
        method: 'POST',
        url: 'https://example.com/auth/token',
        pathParams: '',
        searchParams: '',
        auth: { type: 'noauth' },
        preRequestScript: '',
        postRequestScript: '',
        testScript: '',
        responseVisualizer: '',
        responseTableAccessor: '',
        preferredResponseBodyView: 'raw',
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'text',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('expired', {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response('', {
            status: 204,
            statusText: 'No Content',
            headers: { 'content-type': 'text/plain' },
          })
        )
        .mockResolvedValueOnce(
          new Response('ok', {
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'text/plain' },
          })
        )
    )

    const emitGenericEventSpy = vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)

    const result = await sendRequest({
      requestId: 'request-1',
      method: 'POST',
      url: 'https://example.com/protected',
      pathParams: '',
      searchParams: '',
      auth: { type: 'bearer', token: '{{token}}', tokenRefreshRequestId: 'request-refresh' },
      preRequestScript: '',
      postRequestScript: '',
      testScript: '',
      headers: '',
      body: 'base-body',
      bodyType: 'raw',
      rawType: 'text',
      activeEnvironmentIds: [],
      saveToHistory: false,
      historyKeepLast: 10,
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: false,
        retryCount: 0,
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected original 401 response to be returned before retry event')
    }

    expect(result.data.status).toBe(401)
    expect(emitGenericEventSpy).toHaveBeenCalledWith({
      type: 'retry-request',
      requestId: 'request-1',
      requestMetadata: {
        sourceRuntime: 'request-editor',
        isRetry: true,
        retryCount: 1,
      },
    })
    expect(httpRequestRuntime.prepareHttpRequest).toHaveBeenCalledTimes(2)
  })
})

function createPreparedRequest(input?: {
  requestId?: string
  requestName?: string
  url?: string
  resolvedAuth?: HttpAuth
  runtimeRequestAuth?: HttpAuth
}): PreparedHttpRequest {
  return {
    requestId: input?.requestId ?? 'request-1',
    requestName: input?.requestName ?? 'Test Request',
    runtime: {
      request: {
        method: 'POST',
        url: input?.url ?? 'https://example.com',
        pathParams: '',
        searchParams: '',
        auth: input?.runtimeRequestAuth ?? ({ type: 'noauth' } as const),
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
      runPostRequestScripts: async () => ({ scriptErrors: [], retryRequested: false }),
      runTestScripts: async () => ({ scriptErrors: [], registeredTests: 0, testRun: null }),
    },
    variables: {},
    method: 'POST' as const,
    url: input?.url ?? 'https://example.com',
    resolvedAuth: input?.resolvedAuth ?? ({ type: 'noauth' } as const),
    headers: new Headers({ 'content-type': 'application/json', 'x-base': '1' }),
    resolvedBody: { kind: 'raw' as const, value: 'base-body' },
    requestBody: {
      body: 'base-body',
      preview: 'base-body',
    },
    postRequestScriptSources: [],
    testScriptSources: [],
  }
}
