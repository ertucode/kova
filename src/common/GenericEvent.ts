import type { HttpSseStreamState, WebSocketSessionRecord } from './Requests.js'
import type { ScriptPromptRequest } from './ScriptPrompt.js'
import type { ScriptToastOptions } from './ScriptToast.js'

export type GenericEvent = {
  type: 'reload-path'
  path: string
  fileToSelect?: $Maybe<string>
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
}
