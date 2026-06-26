import type { HttpAuth } from './Auth.js'
import type { EnvironmentRecord } from './Environments.js'
import type { OperationRecord } from './Operations.js'
import type { ScriptCallRequestOverrides } from './ScriptMakeRequest.js'

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestRuntimePhase = 'pre-request' | 'post-request' | 'test' | 'template-expression'

export type RequestRuntimeSource = 'request-editor' | 'call-request' | 'navigate-and-call-request' | 'generate-request-code' | 'folder-run' | 'websocket'

export type SendRequestMetadata = {
  sourceRuntime: RequestRuntimeSource
  isRetry: boolean
  retryCount: number
}

export type RequestType = 'http' | 'websocket'

export type RequestBodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'none' | 'graphql'

export type RequestRawType = 'json' | 'text'

export type ResponseBodyView = 'raw' | 'table' | 'visualizer'

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
  testScript: string
  responseVisualizer: string
  responseTableAccessor: string
  preferredResponseBodyView: ResponseBodyView
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery?: string
  graphqlVariables?: string
  graphqlSchema?: string
  websocketSubprotocols: string
  websocketOnOpenMessage: string
  websocketAutoSendEnabled: boolean
  websocketAutoSendMessage: string
  websocketAutoSendIntervalSeconds: number
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
  testScript: string
  responseVisualizer: string
  responseTableAccessor: string
  preferredResponseBodyView: ResponseBodyView
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery?: string
  graphqlVariables?: string
  graphqlSchema?: string
  websocketSubprotocols: string
  websocketOnOpenMessage: string
  websocketAutoSendEnabled: boolean
  websocketAutoSendMessage: string
  websocketAutoSendIntervalSeconds: number
  saveToHistory: boolean
}

export type UpdateRequestResponseBodyViewPreferenceInput = {
  id: string
  preferredResponseBodyView: ResponseBodyView
}

export type DeleteRequestInput = {
  id: string
}

export type DeleteRequestResponse = {
  operation: OperationRecord
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
  testScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery?: string
  graphqlVariables?: string
  activeEnvironmentIds: string[]
  environmentSnapshot?: EnvironmentRecord[]
  saveToHistory: boolean
  historyKeepLast: number
  callRequestOverrides?: ScriptCallRequestOverrides
  requestMetadata?: SendRequestMetadata
  folderRunId?: string
  folderRunFolderId?: string
}

export type FetchGraphqlSchemaInput = {
  requestId: string
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery?: string
  graphqlVariables?: string
  activeEnvironmentIds: string[]
}

export type FetchGraphqlSchemaResponse = {
  schema: string
}

export type CancelHttpRequestInput = {
  requestId: string
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
  websocketOnOpenMessage: string
  websocketAutoSendEnabled: boolean
  websocketAutoSendMessage: string
  websocketAutoSendIntervalSeconds: number
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
  phase: 'pre-request' | 'post-request' | 'test'
  sourceName: string
  message: string
  compactLabel: string
  compactMessage: string
  detailedMessage: string
  line: number | null
  column: number | null
  sourceLine: string | null
}

export type RequestConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export type RequestConsoleEntry = {
  id: string
  timestamp: number
  level: RequestConsoleLevel
  sourceName: string
  message: string
}

export type SseEventRecord = {
  id: string | null
  eventName: string | null
  data: string
  retryMs: number | null
  sizeBytes: number
  timestamp: number | null
}

export type HttpSseStreamState = {
  executionId: string
  requestId: string
  requestName: string
  status: number | null
  statusText: string
  headers: string
  body: string
  durationMs: number
  state: 'streaming' | 'completed' | 'cancelled' | 'failed'
  responseError: string | null
  events: SseEventRecord[]
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
  graphqlQuery?: string
  graphqlVariables?: string
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

export type RequestTestFailure = {
  message: string
  matcherName: string | null
  expected: unknown
  actual: unknown
  diff: string | null
  sourceName: string | null
  line: number | null
  column: number | null
  sourceLine: string | null
}

export type RequestTestStatus = 'passed' | 'failed' | 'skipped'

export type RequestTestCaseResult = {
  id: string
  path: string[]
  name: string
  status: RequestTestStatus
  durationMs: number
  failures: RequestTestFailure[]
}

export type RequestTestSuiteResult = {
  id: string
  path: string[]
  name: string
  status: RequestTestStatus
  durationMs: number
  suites: RequestTestSuiteResult[]
  tests: RequestTestCaseResult[]
}

export type RequestTestRun = {
  status: RequestTestStatus
  totalCount: number
  passedCount: number
  failedCount: number
  skippedCount: number
  durationMs: number
  suites: RequestTestSuiteResult[]
}

export type RequestExecutionRecord = {
  itemType: 'http'
  id: string
  folderRunId?: string | null
  folderRunFolderId?: string | null
  requestId: string
  requestName: string
  request: ExecutedRequestSnapshot
  response: ReceivedResponseSnapshot | null
  responseError: string | null
  scriptErrors: RequestScriptError[]
  testRun: RequestTestRun | null
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
  requestScope: Record<string, string>
  scriptErrors: RequestScriptError[]
  testRun: RequestTestRun | null
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
  requestId?: string
  folderRunId?: string
  offset: number
  limit: number
}

export type ListRequestHistoryResponse = {
  items: RequestHistoryListItem[]
  nextOffset: number | null
  totalCount: number
}

export type GetRequestHistoryCountInput = {
  requestId: string
}

export type GetRequestHistoryCountResponse = {
  totalCount: number
}

export type ListRecentHttpRequestUsageResponse = {
  requestIds: string[]
}

export type DeleteRequestHistoryEntryInput = {
  id: string
}

export type TrimRequestHistoryInput = {
  keepLast: number
}
