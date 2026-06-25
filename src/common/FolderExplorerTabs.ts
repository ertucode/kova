import type { ExplorerItemType } from './Explorer.js'

export type RequestMetaTab =
  | 'overview'
  | 'body'
  | 'search-params'
  | 'headers'
  | 'auth'
  | 'path-params'
  | 'scripts'
  | 'tests'
  | 'response-visualizer'

export type FolderExplorerTabRecord = {
  id: string
  itemType: ExplorerItemType
  itemId: string
  requestMetaTab: RequestMetaTab | null
  position: number
  isPinned: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type SaveFolderExplorerTabsInput = {
  tabs: FolderExplorerTabRecord[]
}

export type UpdateFolderExplorerTabInput = {
  id: string
  requestMetaTab?: RequestMetaTab | null
}
