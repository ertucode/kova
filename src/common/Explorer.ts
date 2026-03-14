export type ExplorerItemType = 'folder' | 'request' | 'example'

type ExplorerItemBase = {
  id: string
  name: string
  position: number
  createdAt: number
  deletedAt: number | null
}

export type ExplorerFolderItem = ExplorerItemBase & {
  itemType: 'folder'
  parentFolderId: string | null
}

export type ExplorerRequestItem = ExplorerItemBase & {
  itemType: 'request'
  parentFolderId: string | null
  method: string
  url: string
}

export type ExplorerExampleItem = ExplorerItemBase & {
  itemType: 'example'
  requestId: string
  responseStatus: number
}

export type ExplorerItem = ExplorerFolderItem | ExplorerRequestItem | ExplorerExampleItem

export type MoveExplorerItemInput =
  | {
      itemType: 'folder' | 'request'
      id: string
      targetParentFolderId: string | null
      targetPosition: number
    }
  | {
      itemType: 'example'
      id: string
      targetRequestId: string
      targetPosition: number
    }
