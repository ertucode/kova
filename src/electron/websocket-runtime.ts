import { getAuthHeaders, getAuthQueryParams, getAuthVariableSources, resolveAuth, resolveInheritedAuth, type HttpAuth } from '../common/Auth.js'
import { buildEnvironmentVariableMap } from '../common/EnvironmentVariables.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { applySearchParamsToUrl } from '../common/PathParams.js'
import { findMissingTemplateVariables, resolveTemplateVariables } from '../common/RequestVariables.js'
import { Result } from '../common/Result.js'
import type {
  RequestConsoleEntry,
  WebSocketConnectInput,
  WebSocketConnectResponse,
  WebSocketDisconnectInput,
  WebSocketMessageRecord,
  WebSocketSendMessageInput,
  WebSocketSessionRecord,
} from '../common/Requests.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { getEnvironmentsByIds } from './db/environments.js'
import { getFolderAncestorChain } from './db/folders.js'
import { getRequest } from './db/requests.js'
import { createWebSocketHistory, appendWebSocketHistoryMessage, finalizeWebSocketHistory } from './db/websocket-history.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { emitGenericEvent } from './generic-events.js'
import { createRequestScriptRuntime } from './request-script-runner.js'

type ActiveWebSocketSession = {
  socket: WebSocket
  session: WebSocketSessionRecord
  historyEnabled: boolean
  historyId: string | null
}

const activeSessions = new Map<string, ActiveWebSocketSession>()

export async function connectWebSocket(input: WebSocketConnectInput): Promise<GenericResult<WebSocketConnectResponse>> {
  try {
    const requestResult = await getRequest({ id: input.requestId })
    if (!requestResult.success) {
      return requestResult
    }

    if (requestResult.data.requestType !== 'websocket') {
      return GenericError.Message('Request is not a websocket request')
    }

    const existingSession = activeSessions.get(input.requestId)
    if (existingSession && existingSession.session.connectionState !== 'closed') {
      return Result.Success({
        session: existingSession.session,
        updatedEnvironments: [],
        consoleEntries: [],
      })
    }

    const [activeEnvironments, parentFolderId] = await Promise.all([
      getEnvironmentsByIds(input.activeEnvironmentIds),
      getRequestParentFolderId(input.requestId),
    ])

    const folders = await getFolderAncestorChain(parentFolderId)
    const runtime = createRequestScriptRuntime({
      request: {
        method: 'GET',
        url: input.url,
        pathParams: '',
        searchParams: input.searchParams,
        auth: input.auth,
        headers: mergeHeaderRows(folders.map(folder => folder.headers), input.headers),
        body: '',
        bodyType: 'none',
        rawType: 'text',
      },
      environments: activeEnvironments,
    })

    await runtime.runPreRequestScripts([
      ...folders.map(folder => ({ name: `Folder: ${folder.name}`, script: folder.preRequestScript })),
      { name: `Request: ${requestResult.data.name}`, script: input.preRequestScript },
    ])

    const variables = runtime.getResolvedVariables()
    const missingVariables = collectMissingVariables({
      url: input.url,
      searchParams: input.searchParams,
      auth: input.auth,
      headers: input.headers,
      websocketSubprotocols: input.websocketSubprotocols,
    }, variables)
    if (missingVariables.length > 0) {
      return GenericError.Message(`Missing environment variables: ${missingVariables.join(', ')}. Define them before connecting.`)
    }

    const effectiveAuth = resolveInheritedAuth(folders.map(folder => folder.auth), runtime.request.auth)
    const missingAuthVariables = getAuthVariableSources(effectiveAuth).flatMap(source => findMissingTemplateVariables(source, variables))
    if (missingAuthVariables.length > 0) {
      return GenericError.Message(`Missing environment variables: ${Array.from(new Set(missingAuthVariables)).join(', ')}. Define them before connecting.`)
    }

    const resolvedAuth = resolveAuth(effectiveAuth, variables)
    const url = applyAuthToUrl(applySearchParamsToUrl(resolveTemplateVariables(runtime.request.url, variables).trim(), runtime.request.searchParams, variables), resolvedAuth)

    if (!url) {
      return GenericError.Message('Request URL is required')
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return GenericError.Message('Request URL is invalid')
    }

    const protocol = parsedUrl.protocol.toLowerCase()
    if (protocol !== 'ws:' && protocol !== 'wss:') {
      return GenericError.Message('WebSocket URL must use ws:// or wss://')
    }

    const headers = new Headers()
    applyAuthHeaders(headers, resolvedAuth)
    applyResolvedHeaders(headers, parseKeyValueRows(runtime.request.headers), variables)

    const connectedAt = Date.now()
    const session: WebSocketSessionRecord = {
      itemType: 'websocket',
      id: crypto.randomUUID(),
      requestId: input.requestId,
      requestName: requestResult.data.name,
      url,
      requestHeaders: Array.from(headers.entries()).map(([key, value]) => `${key}: ${value}`).join('\n'),
      requestVariables: variables,
      connectionState: 'connecting',
      connectedAt,
      disconnectedAt: null,
      closeCode: null,
      closeReason: null,
      responseError: null,
      historySizeBytes: 0,
      messages: [],
    }

    const socket = new WebSocket(url, parseSubprotocols(resolveTemplateVariables(input.websocketSubprotocols, variables)))
    const activeSession: ActiveWebSocketSession = {
      socket,
      session,
      historyEnabled: input.saveToHistory,
      historyId: input.saveToHistory ? session.id : null,
    }
    activeSessions.set(input.requestId, activeSession)
    emitSessionUpdated(activeSession.session)

    if (input.saveToHistory) {
      await createWebSocketHistory({
        id: session.id,
        requestId: session.requestId,
        requestName: session.requestName,
        url: session.url,
        requestHeaders: session.requestHeaders,
        requestVariables: session.requestVariables,
        connectionState: 'connecting',
        connectedAt: session.connectedAt,
        disconnectedAt: session.disconnectedAt,
        closeCode: session.closeCode,
        closeReason: session.closeReason,
        responseError: session.responseError,
        historySizeBytes: 0,
      })
    }

    bindSocketEvents(activeSession)

    await waitForOpenOrError(socket)
    activeSession.session = {
      ...activeSession.session,
      connectionState: 'open',
    }
    emitSessionUpdated(activeSession.session)

    const updatedEnvironments = runtime.getUpdatedEnvironments()
    if (updatedEnvironments.length > 0) {
      emitGenericEvent({
        type: 'environments-updated',
        environmentIds: updatedEnvironments.map(environment => environment.id),
      })
    }

    return Result.Success({
      session: activeSession.session,
      updatedEnvironments,
      consoleEntries: runtime.getConsoleEntries(),
    })
  } catch (error) {
    return GenericError.Message(formatRuntimeError(error))
  }
}

export async function sendWebSocketMessage(input: WebSocketSendMessageInput): Promise<GenericResult<void>> {
  const activeSession = activeSessions.get(input.requestId)
  if (!activeSession || activeSession.session.connectionState !== 'open') {
    return GenericError.Message('WebSocket is not connected')
  }

  try {
    const activeEnvironments = await getEnvironmentsByIds(input.activeEnvironmentIds)
    const variables = buildEnvironmentVariableMap(activeEnvironments)
    const missingVariables = findMissingTemplateVariables(input.body, variables)
    if (missingVariables.length > 0) {
      return GenericError.Message(`Missing environment variables: ${Array.from(new Set(missingVariables)).join(', ')}. Define them before sending.`)
    }

    const resolvedBody = resolveTemplateVariables(input.body, variables)
    activeSession.socket.send(resolvedBody)
    const message = buildMessageRecord('sent', resolvedBody)
    await appendMessage(activeSession, message)
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Message(formatRuntimeError(error))
  }
}

export async function disconnectWebSocket(input: WebSocketDisconnectInput): Promise<GenericResult<void>> {
  const activeSession = activeSessions.get(input.requestId)
  if (!activeSession) {
    return Result.Success(undefined)
  }

  try {
    if (activeSession.socket.readyState === WebSocket.OPEN || activeSession.socket.readyState === WebSocket.CONNECTING) {
      activeSession.socket.close(1000, 'Disconnected')
    }
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Message(formatRuntimeError(error))
  }
}

function bindSocketEvents(activeSession: ActiveWebSocketSession) {
  const { socket } = activeSession

  socket.addEventListener('message', event => {
    void handleIncomingMessage(activeSession, event.data).catch(error => {
      console.error('handleIncomingMessage failed', error)
    })
  })

  socket.addEventListener('close', event => {
    void finalizeSession(activeSession, {
      disconnectedAt: Date.now(),
      closeCode: event.code,
      closeReason: event.reason || null,
      responseError: activeSession.session.responseError,
    }).catch(error => {
      console.error('finalizeSession failed', error)
    })
  })

  socket.addEventListener('error', () => {
    activeSession.session = {
      ...activeSession.session,
      responseError: 'WebSocket connection error',
    }
    emitSessionUpdated(activeSession.session)
  })
}

async function handleIncomingMessage(activeSession: ActiveWebSocketSession, data: unknown) {
  const normalized = await normalizeWebSocketData(data)
  await appendMessage(activeSession, buildMessageRecord('received', normalized.body, normalized.mimeType, normalized.sizeBytes))
}

async function appendMessage(activeSession: ActiveWebSocketSession, message: WebSocketMessageRecord) {
  activeSession.session = {
    ...activeSession.session,
    historySizeBytes: activeSession.session.historySizeBytes + message.sizeBytes,
    messages: [...activeSession.session.messages, message],
  }

  emitSessionUpdated(activeSession.session)
  if (activeSession.historyEnabled && activeSession.historyId) {
    await appendWebSocketHistoryMessage({ historyId: activeSession.historyId, message })
  }
}

async function finalizeSession(
  activeSession: ActiveWebSocketSession,
  input: { disconnectedAt: number; closeCode: number | null; closeReason: string | null; responseError: string | null }
) {
  activeSession.session = {
    ...activeSession.session,
    connectionState: 'closed',
    disconnectedAt: input.disconnectedAt,
    closeCode: input.closeCode,
    closeReason: input.closeReason,
    responseError: input.responseError,
  }
  emitSessionUpdated(activeSession.session)

  if (activeSession.historyEnabled && activeSession.historyId) {
    await finalizeWebSocketHistory({
      historyId: activeSession.historyId,
      disconnectedAt: input.disconnectedAt,
      closeCode: input.closeCode,
      closeReason: input.closeReason,
      responseError: input.responseError,
    })
  }

  activeSessions.delete(activeSession.session.requestId)
}

function emitSessionUpdated(session: WebSocketSessionRecord) {
  emitGenericEvent({
    type: 'websocket-session-updated',
    session,
  })
}

function waitForOpenOrError(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error('Unable to connect to websocket server'))
    }
    const cleanup = () => {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
    }
    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })
}

function parseSubprotocols(value: string) {
  return value
    .split(/[\n,]/)
    .map(entry => entry.trim())
    .filter(Boolean)
}

function buildMessageRecord(
  direction: WebSocketMessageRecord['direction'],
  body: string,
  mimeType = inferMimeType(body),
  sizeBytes = getByteLength(body)
): WebSocketMessageRecord {
  return {
    id: crypto.randomUUID(),
    direction,
    body,
    mimeType,
    sizeBytes,
    timestamp: Date.now(),
  }
}

async function normalizeWebSocketData(data: unknown) {
  if (typeof data === 'string') {
    return { body: data, mimeType: inferMimeType(data), sizeBytes: getByteLength(data) }
  }

  if (data instanceof ArrayBuffer) {
    const body = Buffer.from(data).toString('utf8')
    return { body, mimeType: 'application/octet-stream', sizeBytes: data.byteLength }
  }

  if (ArrayBuffer.isView(data)) {
    const body = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
    return { body, mimeType: 'application/octet-stream', sizeBytes: data.byteLength }
  }

  if (data instanceof Blob) {
    const buffer = await data.arrayBuffer()
    const body = Buffer.from(buffer).toString('utf8')
    return { body, mimeType: data.type || 'application/octet-stream', sizeBytes: buffer.byteLength }
  }

  const body = String(data)
  return { body, mimeType: inferMimeType(body), sizeBytes: getByteLength(body) }
}

function collectMissingVariables(
  input: Pick<WebSocketConnectInput, 'url' | 'searchParams' | 'auth' | 'headers' | 'websocketSubprotocols'>,
  variables: Record<string, string>
) {
  const missingVariables = new Set<string>()

  for (const variableName of findMissingTemplateVariables(input.url, variables)) {
    missingVariables.add(variableName)
  }

  for (const row of parseKeyValueRows(input.searchParams)) {
    if (!row.enabled) {
      continue
    }
    for (const variableName of findMissingTemplateVariables(row.key, variables)) {
      missingVariables.add(variableName)
    }
    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const source of getAuthVariableSources(input.auth)) {
    for (const variableName of findMissingTemplateVariables(source, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const row of parseKeyValueRows(input.headers)) {
    if (!row.enabled) {
      continue
    }
    for (const variableName of findMissingTemplateVariables(row.key, variables)) {
      missingVariables.add(variableName)
    }
    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const variableName of findMissingTemplateVariables(input.websocketSubprotocols, variables)) {
    missingVariables.add(variableName)
  }

  return Array.from(missingVariables).sort((left, right) => left.localeCompare(right))
}

function applyResolvedHeaders(headers: Headers, rows: ReturnType<typeof parseKeyValueRows>, variables: Record<string, string>) {
  for (const row of rows) {
    const key = resolveTemplateVariables(row.key, variables).trim()
    if (!row.enabled || !key) {
      continue
    }
    headers.set(key, resolveTemplateVariables(row.value, variables))
  }
}

function applyAuthHeaders(headers: Headers, auth: HttpAuth) {
  for (const entry of getAuthHeaders(auth)) {
    headers.set(entry.key, entry.value)
  }
}

function applyAuthToUrl(url: string, auth: HttpAuth) {
  const entries = getAuthQueryParams(auth)
  if (entries.length === 0) {
    return url
  }

  const nextUrl = new URL(url)
  for (const entry of entries) {
    nextUrl.searchParams.set(entry.key, entry.value)
  }
  return nextUrl.toString()
}

function mergeHeaderRows(folderHeaders: string[], requestHeaders: string) {
  const mergedRows: Array<{ key: string; value: string; enabled: boolean }> = []
  const pushRows = (value: string) => {
    for (const row of parseKeyValueRows(value)) {
      const key = row.key.trim()
      if (!row.enabled || !key) {
        continue
      }

      const existingIndex = mergedRows.findIndex(entry => entry.key.toLowerCase() === key.toLowerCase())
      const nextEntry = { key: row.key, value: row.value, enabled: row.enabled }
      if (existingIndex >= 0) {
        mergedRows[existingIndex] = nextEntry
      } else {
        mergedRows.push(nextEntry)
      }
    }
  }

  for (const value of folderHeaders) {
    pushRows(value)
  }
  pushRows(requestHeaders)
  return mergedRows.map(row => `${row.key}:${row.value}`).join('\n')
}

function inferMimeType(body: string) {
  const normalized = body.trim()
  if (!normalized) {
    return 'text/plain'
  }
  if (/^[\[{]/.test(normalized)) {
    try {
      JSON.parse(normalized)
      return 'application/json'
    } catch {
      return 'text/plain'
    }
  }
  return 'text/plain'
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function formatRuntimeError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return String(error)
}
