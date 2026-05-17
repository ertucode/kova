import type { ScriptResponseBody } from './Requests.js'

export type ScriptMakeRequestRequest = {
  id: string
  requestId: string
  path: string[]
}

export type ScriptCallRequestRequest = {
  id: string
  requestId: string
  path: string[]
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
