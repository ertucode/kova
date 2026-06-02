import type { HttpSseStreamState, WebSocketSessionRecord } from './Requests.js'
import type { ScriptAiWorkspaceState } from './ScriptAi.js'
import type { ScriptCallRequestRequest, ScriptMakeRequestRequest } from './ScriptMakeRequest.js'
import type { ScriptPromptRequest } from './ScriptPrompt.js'
import type { ScriptToastOptions } from './ScriptToast.js'
import type { SendRequestMetadata } from './Requests.js'

export type GenericEvent = {
  type: 'reload-path'
  path: string
  fileToSelect?: $Maybe<string>
} | {
  type: 'cookies-updated'
} | {
  type: 'environments-updated'
  environmentIds: string[]
} | {
  type: 'websocket-session-updated'
  session: WebSocketSessionRecord
} | {
  type: 'websocket-session-cleared'
  requestId: string
} | {
  type: 'http-sse-stream-updated'
  stream: HttpSseStreamState
} | {
  type: 'http-sse-stream-cleared'
  requestId: string
} | {
  type: 'script-toast-show'
  toast: ScriptToastOptions
} | {
  type: 'script-toast-hide'
  id: string
} | {
  type: 'script-prompt-request'
  prompt: ScriptPromptRequest
} | {
  type: 'script-make-request'
  request: ScriptMakeRequestRequest
} | {
  type: 'script-call-request'
  request: ScriptCallRequestRequest
} | {
  type: 'script-retry-request'
  requestId: string
  requestMetadata: SendRequestMetadata
} | {
  type: 'script-ai-state-updated'
  state: ScriptAiWorkspaceState
}
