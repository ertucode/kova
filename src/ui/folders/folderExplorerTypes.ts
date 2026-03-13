import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import type { KeyValueRow } from '@common/KeyValueRows'
import type { HttpRequestRecord, RequestBodyType, RequestMethod, RequestRawType } from '@common/Requests'

export type TreeNode = ExplorerItem & {
  children: TreeNode[]
}

export type Selection = {
  itemType: ExplorerItem['itemType']
  id: string
}

export type CreateDraft = {
  itemType: ExplorerItem['itemType']
  parentFolderId: string | null
  name: string
}

export type FolderDetailsDraft = {
  itemType: 'folder'
  name: string
  description: string
  preRequestScript: string
  postRequestScript: string
}

export type RequestDetailsDraft = {
  itemType: 'request'
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

export type DetailsDraft = FolderDetailsDraft | RequestDetailsDraft

export type HeaderRow = KeyValueRow

export const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export const REQUEST_BODY_TYPES: RequestBodyType[] = ['none', 'raw', 'form-data', 'x-www-form-urlencoded']

export const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']

export type DetailEntity = FolderRecord | HttpRequestRecord
