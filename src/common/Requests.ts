import type { HttpAuth } from './Auth.js'
import type { EnvironmentRecord } from './Environments.js'

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestType = 'http' | 'websocket'

export type RequestBodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'none'

export type RequestRawType = 'json' | 'text'

export type HttpRequestRecord = {
  id: string
  name: string
  requestType: RequestType
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  websocketSubprotocols: string
  saveToHistory: boolean
  createdAt: number
  deletedAt: number | null
}

export type CreateRequestInput = {
  parentFolderId: string | null
  name: string
  requestType: RequestType
}

export type GetRequestInput = {
  id: string
}

export type UpdateRequestInput = {
  id: string
  name: string
  requestType: RequestType
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  websocketSubprotocols: string
  saveToHistory: boolean
}

export type DeleteRequestInput = {
  id: string
}

export type DuplicateRequestInput = {
  id: string
}

export type SendRequestInput = {
  requestId: string
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  activeEnvironmentIds: string[]
  historyKeepLast: number
}

export type WebSocketConnectInput = {
  requestId: string
  url: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  headers: string
  websocketSubprotocols: string
  activeEnvironmentIds: string[]
  saveToHistory: boolean
  historyKeepLast: number
}

export type WebSocketSendMessageInput = {
  requestId: string
  body: string
  activeEnvironmentIds: string[]
}

export type WebSocketDisconnectInput = {
  requestId: string
}

export type WebSocketSavedMessageRecord = {
  id: string
  requestId: string
  body: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ListWebSocketSavedMessagesInput = {
  requestId: string
}

export type CreateWebSocketSavedMessageInput = {
  requestId: string
  body: string
}

export type UpdateWebSocketSavedMessageInput = {
  id: string
  body: string
}

export type DeleteWebSocketSavedMessageInput = {
  id: string
}

export type ScriptResponseBody =
  | {
      type: 'json'
      data: unknown
    }
  | {
      type: 'text'
      data: string
    }

export type RequestScriptError = {
  phase: 'post-request'
  sourceName: string
  message: string
}

export type RequestConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type RequestConsoleEntry = {
  id: string
  timestamp: number
  level: RequestConsoleLevel
  sourceName: string
  message: string
}

export type ExecutedRequestSnapshot = {
  requestId: string
  requestName: string
  method: RequestMethod
  url: string
  headers: string
  body: string
  variables: Record<string, string>
  bodyType: RequestBodyType
  rawType: RequestRawType
  sentAt: number
}

export type ReceivedResponseSnapshot = {
  status: number
  statusText: string
  headers: string
  body: string
  bodyOmitted: boolean
  durationMs: number
  receivedAt: number
}

export type RequestExecutionRecord = {
  itemType: 'http'
  id: string
  requestId: string
  requestName: string
  request: ExecutedRequestSnapshot
  response: ReceivedResponseSnapshot | null
  responseError: string | null
  scriptErrors: RequestScriptError[]
  consoleEntries: RequestConsoleEntry[]
}

export type WebSocketMessageDirection = 'sent' | 'received'

export type WebSocketMessageRecord = {
  id: string
  direction: WebSocketMessageDirection
  body: string
  mimeType: string | null
  sizeBytes: number
  timestamp: number
}

export type WebSocketConnectionState = 'connecting' | 'open' | 'closed'

export type WebSocketSessionRecord = {
  itemType: 'websocket'
  id: string
  requestId: string
  requestName: string
  url: string
  requestHeaders: string
  requestVariables: Record<string, string>
  connectionState: WebSocketConnectionState
  connectedAt: number
  disconnectedAt: number | null
  closeCode: number | null
  closeReason: string | null
  responseError: string | null
  historySizeBytes: number
  messages: WebSocketMessageRecord[]
}

export type RequestHistoryListItem = RequestExecutionRecord | WebSocketSessionRecord

export type SendRequestResponse = {
  status: number
  statusText: string
  headers: string
  body: string
  durationMs: number
  scriptErrors: RequestScriptError[]
  updatedEnvironments: EnvironmentRecord[]
  consoleEntries: RequestConsoleEntry[]
  execution: RequestExecutionRecord
}

export type WebSocketConnectResponse = {
  session: WebSocketSessionRecord
  updatedEnvironments: EnvironmentRecord[]
  consoleEntries: RequestConsoleEntry[]
}

export type ListRequestHistoryInput = {
  searchQuery: string
  offset: number
  limit: number
}

export type ListRequestHistoryResponse = {
  items: RequestHistoryListItem[]
  nextOffset: number | null
}

export type DeleteRequestHistoryEntryInput = {
  id: string
}

export type TrimRequestHistoryInput = {
  keepLast: number
}
