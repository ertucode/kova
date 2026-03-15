import type { WebSocketSessionRecord } from './Requests.js'

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
}
