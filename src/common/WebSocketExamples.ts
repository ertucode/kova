import type { WebSocketMessageDirection } from './Requests.js'

export type WebSocketExampleMessageRecord = {
  id: string
  exampleId: string
  direction: WebSocketMessageDirection
  body: string
  mimeType: string | null
  sizeBytes: number
  timestamp: number
  createdAt: number
}

export type WebSocketExampleRecord = {
  id: string
  requestId: string
  name: string
  position: number
  requestHeaders: string
  requestBody: string
  messageCount: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  messages: WebSocketExampleMessageRecord[]
}

export type CreateWebSocketExampleInput = {
  requestId: string
  name: string
  requestHeaders: string
  requestBody: string
  messages: Array<{
    direction: WebSocketMessageDirection
    body: string
    mimeType: string | null
    sizeBytes: number
    timestamp: number
  }>
}

export type GetWebSocketExampleInput = {
  id: string
}

export type UpdateWebSocketExampleInput = {
  id: string
  name: string
  requestHeaders: string
  requestBody: string
}

export type DeleteWebSocketExampleInput = {
  id: string
}

export type MoveWebSocketExampleInput = {
  id: string
  requestId: string
  targetPosition: number
}
