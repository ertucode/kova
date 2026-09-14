import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpAuth } from '../common/Auth.js'
import { Result } from '../common/Result.js'
import { fetch as undiciFetch, Response as UndiciResponse } from 'undici'
import * as cookieDb from './db/cookies.js'
import * as requestDb from './db/requests.js'
import * as explorerDb from './db/explorer.js'
import * as folderDb from './db/folders.js'
import * as environmentDb from './db/environments.js'
import * as sharedScriptDb from './db/shared-scripts.js'
import * as scriptPackageDb from './db/script-packages.js'
import * as genericEvents from './generic-events.js'
import * as httpRequestRuntime from './http-request-runtime.js'
import type { PreparedHttpRequest } from './http-request-runtime.js'
import { applyScriptCallRequestOverrides, cancelHttpRequest, sendRequest } from './send-request.js'

vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>()
  return {
    ...actual,
    fetch: vi.fn(),
  }
})

const mockedUndiciFetch = vi.mocked(undiciFetch)

afterEach(() => {
  mockedUndiciFetch.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('sendRequest JSON body transport', () => {
  beforeEach(() => {
    // Keep request preparation and the script runtime real; stub only external IO.
    vi.spyOn(requestDb, 'getRequest').mockResolvedValue(Result.Success({
      ...createSendRequestInput(),
      id: 'request-1',
      name: 'JSON request',
      requestType: 'http',
      responseVisualizer: '',
      responseTableAccessor: '',
      preferredResponseBodyView: 'raw',
      websocketSubprotocols: '',
      websocketOnOpenMessage: '',
      websocketAutoSendEnabled: false,
      websocketAutoSendMessage: '',
      websocketAutoSendIntervalSeconds: 0,
      ...mcpRequestFieldDefaults(),
      createdAt: 1,
      deletedAt: null,
    }))
    vi.spyOn(explorerDb, 'getRequestParentFolderId').mockResolvedValue(null)
    vi.spyOn(folderDb, 'getFolderAncestorChain').mockResolvedValue([])
    vi.spyOn(environmentDb, 'listVisibleEnvironments').mockResolvedValue([])
    vi.spyOn(sharedScriptDb, 'listVisibleSharedScripts').mockResolvedValue([])
    vi.spyOn(scriptPackageDb, 'listScriptPackages').mockResolvedValue([])
    vi.spyOn(cookieDb, 'getCookieHeaderForUrl').mockResolvedValue('')
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    mockedUndiciFetch.mockResolvedValue(new UndiciResponse('ok'))
  })

  it.each([
    {
      body: '{ "asdfasdf": 21093120398102398123, asdasdasd: 45, // lkasjdfl\n}',
      expected: '{"asdfasdf":21093120398102398123,"asdasdasd":45}',
    },
    {
      body: "{nested: [{id: {{longId}}, label: 'test',},], /* comment */}",
      expected: '{"nested":[{"id":21093120398102398123,"label":"test"}]}',
    },
  ])('sends strict JSON with exact numeric digits: $body', async ({ body, expected }) => {
    const result = await sendRequest({
      ...createSendRequestInput(),
      rawType: 'json',
      body,
      immutableVariables: { longId: '21093120398102398123' },
    })

    expect(result.success).toBe(true)
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1)
    const init = mockedUndiciFetch.mock.calls[0]?.[1]
    expect(init?.body).toBe(expected)
    expect(() => JSON.parse(String(init?.body))).not.toThrow()
    expect(new Headers(init?.headers as Headers).get('content-type')).toBe('application/json')
    if (!result.success) throw new Error('Expected request to succeed')
    expect(result.data.execution.request.body).toBe(expected)
  })

  it('normalizes JSON5 assigned by a pre-request script', async () => {
    const result = await sendRequest({
      ...createSendRequestInput(),
      rawType: 'json',
      body: '{}',
      preRequestScript: `request.body = "{id: 21093120398102398123,}"`,
    })
    expect(result.success).toBe(true)
    expect(mockedUndiciFetch.mock.calls[0]?.[1]?.body).toBe('{"id":21093120398102398123}')
  })

  it('rejects invalid JSON5 before sending', async () => {
    const result = await sendRequest({ ...createSendRequestInput(), rawType: 'json', body: '{' })
    expect(result).toMatchObject({ success: false, error: { message: expect.stringContaining('Invalid JSON body:') } })
    expect(mockedUndiciFetch).not.toHaveBeenCalled()
  })

  it('sends raw text verbatim', async () => {
    const body = "{unquoted: 'text', // keep this\n}"
    const result = await sendRequest({ ...createSendRequestInput(), body })
    expect(result.success).toBe(true)
    expect(mockedUndiciFetch.mock.calls[0]?.[1]?.body).toBe(body)
  })
})

describe('applyScriptCallRequestOverrides', () => {
  it('uses preassigned execution and batch IDs without publishing SSE editor events', async () => {
    const emitGenericEventSpy = vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockResolvedValue(Result.Success(createPreparedRequest()))
    vi.spyOn(cookieDb, 'storeResponseCookies').mockResolvedValue(undefined)
    mockedUndiciFetch.mockResolvedValue(
      new UndiciResponse('data: complete\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    )

    const result = await sendRequest({
      ...createSendRequestInput(),
      executionId: 'execution-1',
      requestBatchId: 'batch-1',
      requestBatchRowId: 'row-1',
      suppressSseEvents: true,
    })

    expect(result.success).toBe(true)
    if (!result.success) {
      throw new Error('Expected SSE request to succeed')
    }
    expect(result.data.execution).toMatchObject({
      id: 'execution-1',
      requestBatchId: 'batch-1',
      requestBatchRowId: 'row-1',
    })
    expect(emitGenericEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'http-sse-stream-cleared' }))
    expect(emitGenericEventSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'http-sse-stream-updated' }))
  })

  it('cancels an exact execution without cancelling another execution of the same request', async () => {
    vi.spyOn(genericEvents, 'emitGenericEvent').mockImplementation(() => undefined)
    vi.spyOn(httpRequestRuntime, 'prepareHttpRequest').mockResolvedValue(Result.Success(createPreparedRequest()))
    const signals: AbortSignal[] = []
    mockedUndiciFetch.mockImplementation(async (_url, init) => {
      const signal = init?.signal
      if (!signal) {
        throw new Error('Expected an abort signal')
      }
      signals.push(signal)
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      throw new Error('Unreachable')
    })

    const firstRequest = sendRequest({ ...createSendRequestInput(), executionId: 'execution-1' })
    const secondRequest = sendRequest({ ...createSendRequestInput(), executionId: 'execution-2' })
    await vi.waitFor(() => expect(signals).toHaveLength(2))

    await cancelHttpRequest({ executionId: 'execution-1' })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    await cancelHttpRequest({ requestId: 'request-1' })
    expect(signals[1]?.aborted).toBe(true)
    await expect(firstRequest).resolves.toMatchObject({ success: false })
    await expect(secondRequest).resolves.toMatchObject({ success: false })
  })

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

    mockedUndiciFetch.mockResolvedValue(
      new UndiciResponse(JSON.stringify({ retry: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
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
      tlsVerificationMode: 'inherit',
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
    expect(mockedUndiciFetch).toHaveBeenCalledTimes(1)
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
    mockedUndiciFetch.mockResolvedValue(
      new UndiciResponse('ok', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
      })
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
      tlsVerificationMode: 'inherit',
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
        tlsVerificationMode: 'inherit',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        ...mcpRequestFieldDefaults(),
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    })
    mockedUndiciFetch
      .mockResolvedValueOnce(
        new UndiciResponse('expired', {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse('token', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse('ok', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        })
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
      tlsVerificationMode: 'inherit',
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
        tlsVerificationMode: 'inherit',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        ...mcpRequestFieldDefaults(),
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    )
    mockedUndiciFetch
      .mockResolvedValueOnce(
        new UndiciResponse('expired', {
          status: 403,
          statusText: 'Forbidden',
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse('still expired', {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
        })
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
      tlsVerificationMode: 'inherit',
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
        tlsVerificationMode: 'inherit',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        ...mcpRequestFieldDefaults(),
        saveToHistory: false,
        createdAt: 1,
        deletedAt: null,
      })
    )
    mockedUndiciFetch
      .mockResolvedValueOnce(
        new UndiciResponse('expired', {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse(null, {
          status: 204,
          statusText: 'No Content',
          headers: { 'content-type': 'text/plain' },
        })
      )
      .mockResolvedValueOnce(
        new UndiciResponse('ok', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
        })
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
      tlsVerificationMode: 'inherit',
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

function createSendRequestInput() {
  return {
    requestId: 'request-1',
    method: 'POST' as const,
    url: 'https://example.com',
    pathParams: '',
    searchParams: '',
    auth: { type: 'noauth' as const },
    preRequestScript: '',
    postRequestScript: '',
    testScript: '',
    headers: '',
    body: 'base-body',
    bodyType: 'raw' as const,
    rawType: 'text' as const,
    tlsVerificationMode: 'inherit' as const,
    activeEnvironmentIds: [],
    saveToHistory: false,
    historyKeepLast: 10,
  }
}

function mcpRequestFieldDefaults() {
  return {
    mcpTransport: undefined,
    mcpServerUrl: undefined,
    mcpAccessToken: undefined,
    mcpSelectedToolName: undefined,
    mcpSelectedResourceUri: undefined,
    mcpSelectedPromptName: undefined,
    mcpArguments: undefined,
    mcpIntrospection: undefined,
  }
}
