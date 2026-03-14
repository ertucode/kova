import type { ExplorerItemType } from './Explorer.js'

export type FolderExplorerTabRecord = {
  id: string
  itemType: ExplorerItemType
  itemId: string
  position: number
  isPinned: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type SaveFolderExplorerTabsInput = {
  tabs: FolderExplorerTabRecord[]
}
