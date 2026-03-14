import type { EnvironmentRecord } from './Environments.js'

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestBodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'none'

export type RequestRawType = 'json' | 'text'

export type HttpRequestRecord = {
  id: string
  name: string
  method: RequestMethod
  url: string
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  createdAt: number
  deletedAt: number | null
}

export type CreateRequestInput = {
  parentFolderId: string | null
  name: string
}

export type GetRequestInput = {
  id: string
}

export type UpdateRequestInput = {
  id: string
  name: string
  method: RequestMethod
  url: string
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
}

export type DeleteRequestInput = {
  id: string
}

export type SendRequestInput = {
  requestId: string
  method: RequestMethod
  url: string
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  activeEnvironmentIds: string[]
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
  durationMs: number
  receivedAt: number
}

export type RequestExecutionRecord = {
  id: string
  requestId: string
  requestName: string
  request: ExecutedRequestSnapshot
  response: ReceivedResponseSnapshot | null
  responseError: string | null
  scriptErrors: RequestScriptError[]
  consoleEntries: RequestConsoleEntry[]
}

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
