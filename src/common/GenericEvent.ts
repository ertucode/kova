import type { HttpSseStreamState, WebSocketSessionRecord } from './Requests.js'

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
}
