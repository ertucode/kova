import type { ExplorerItemType } from './Explorer.js'

export type FolderExplorerPaneId = string

export const DEFAULT_FOLDER_EXPLORER_PANE_ID: FolderExplorerPaneId = 'pane:1'

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
  | 'batch'

export type FolderExplorerTabRecord = {
  id: string
  itemType: ExplorerItemType
  itemId: string
  paneId: FolderExplorerPaneId
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
