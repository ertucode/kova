import type { ExplorerItemType } from './Explorer.js'

export type RequestMetaTab =
  | 'overview'
  | 'body'
  | 'search-params'
  | 'headers'
  | 'auth'
  | 'settings'
  | 'path-params'
  | 'explore'
  | 'invoke'
  | 'resources'
  | 'prompts'
  | 'scripts'
  | 'tests'
  | 'raw'
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
