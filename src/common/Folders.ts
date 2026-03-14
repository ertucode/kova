import type { HttpAuth } from './Auth.js'

export type FolderRecord = {
  id: string
  name: string
  description: string
  headers: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
  createdAt: number
  deletedAt: number | null
}

export type CreateFolderInput = {
  parentFolderId: string | null
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
  headers: string
  auth: HttpAuth
  preRequestScript: string
  postRequestScript: string
}

export type DeleteFolderInput = {
  id: string
}
