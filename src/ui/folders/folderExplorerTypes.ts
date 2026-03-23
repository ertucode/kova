import type { HttpAuth } from '@common/Auth'
import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import type { KeyValueRow } from '@common/KeyValueRows'
import type { RequestExampleRecord } from '@common/RequestExamples'
import type { HttpRequestRecord, RequestBodyType, RequestMethod, RequestRawType, RequestType } from '@common/Requests'
import type { WebSocketExampleRecord } from '@common/WebSocketExamples'

export type TreeNode = ExplorerItem & {
  children: TreeNode[]
}

export type ExplorerDropTarget = {
  targetParentFolderId: string | null
  targetRequestId: string | null
  targetPosition: number
  placement: 'before' | 'after' | 'inside'
  indicatorId: string
}

export type Selection = {
  itemType: ExplorerItem['itemType']
  id: string
}

export type CreateDraft = {
  itemType: ExplorerItem['itemType']
  parentFolderId: string | null
  name: string
  requestType?: RequestType
}

export type FolderDetailsDraft = {
  itemType: 'folder'
  name: string
  description: string
  headers: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
}

export type RequestDetailsDraft = {
  itemType: 'request'
  name: string
  requestType: RequestType
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  responseVisualizer: string
  prefersResponseVisualizer: boolean
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  websocketSubprotocols: string
  saveToHistory: boolean
}

export type RequestExampleDetailsDraft = {
  itemType: 'example'
  exampleType: 'http'
  name: string
  requestHeaders: string
  requestBody: string
  requestBodyType: RequestBodyType
  requestRawType: RequestRawType
  responseStatus: number
  responseStatusText: string
  responseHeaders: string
  responseBody: string
}

export type WebSocketExampleDetailsDraft = {
  itemType: 'example'
  exampleType: 'websocket'
  name: string
  requestHeaders: string
  requestBody: string
  messages: WebSocketExampleRecord['messages']
}

export type DetailsDraft = FolderDetailsDraft | RequestDetailsDraft | RequestExampleDetailsDraft | WebSocketExampleDetailsDraft

export type HeaderRow = KeyValueRow

export const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export const REQUEST_BODY_TYPES: RequestBodyType[] = ['none', 'raw', 'form-data', 'x-www-form-urlencoded']

export const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']

export type DetailEntity = FolderRecord | HttpRequestRecord | RequestExampleRecord | WebSocketExampleRecord
