import type { RequestMethod, ScriptResponseBody } from './Requests.js'

export type ScriptCallRequestOverrides = {
  method?: RequestMethod
  url?: string
  headers?: Record<string, string | undefined>
  body?: string | undefined
}

export type ScriptMakeRequestRequest = {
  id: string
  requestId: string
  path: string[]
}

export type ScriptCallRequestRequest = {
  id: string
  requestId: string
  path: string[]
  overrides?: ScriptCallRequestOverrides
}

export type ScriptCallRequestPayload = {
  status: number
  statusText: string
  headers: string
  body: ScriptResponseBody
}

export type ScriptMakeRequestResponse = {
  id: string
  error: string | null
}

export type ScriptCallRequestResponse = {
  id: string
  error: string | null
  response: ScriptCallRequestPayload | null
}

export type ScriptRequestBridgeResponse = ScriptMakeRequestResponse | ScriptCallRequestResponse
