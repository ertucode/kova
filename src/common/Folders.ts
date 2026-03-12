export type FolderRecord = {
  id: string
  parentId: string | null
  name: string
  position: number
  createdAt: number
  deletedAt: number | null
}

export type CreateFolderInput = {
  parentId: string | null
  name: string
}

export type RenameFolderInput = {
  id: string
  name: string
}

export type DeleteFolderInput = {
  id: string
}

export type MoveFolderInput = {
  id: string
  parentId: string | null
  position: number
}
