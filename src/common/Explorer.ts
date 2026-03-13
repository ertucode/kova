export type ExplorerItemType = 'folder' | 'request'

type ExplorerItemBase = {
  id: string
  parentFolderId: string | null
  name: string
  position: number
  createdAt: number
  deletedAt: number | null
}

export type ExplorerFolderItem = ExplorerItemBase & {
  itemType: 'folder'
}

export type ExplorerRequestItem = ExplorerItemBase & {
  itemType: 'request'
  method: string
  url: string
}

export type ExplorerItem = ExplorerFolderItem | ExplorerRequestItem

export type MoveExplorerItemInput = {
  itemType: ExplorerItemType
  id: string
  targetParentFolderId: string | null
  targetPosition: number
}
