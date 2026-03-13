export type FolderListItem = {
  id: string
  parentId: string | null
  name: string
  position: number
  createdAt: number
  deletedAt: number | null
}

export type FolderRecord = FolderListItem & {
  description: string
  preRequestScript: string
  postRequestScript: string
}

export type CreateFolderInput = {
  parentId: string | null
  name: string
}

export type RenameFolderInput = {
  id: string
  name: string
}

export type GetFolderInput = {
  id: string
}

export type UpdateFolderInput = {
  id: string
  name: string
  description: string
  preRequestScript: string
  postRequestScript: string
}

export type DeleteFolderInput = {
  id: string
}

export type MoveFolderInput = {
  id: string
  parentId: string | null
  position: number
}
