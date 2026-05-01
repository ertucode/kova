export type ExplorerDeleteOperationType = 'delete-folder' | 'delete-request'

export type SharedScriptDeleteOperationType = 'delete-shared-script'

export type OperationType = ExplorerDeleteOperationType | SharedScriptDeleteOperationType

export type OperationStatus = 'active' | 'undone' | 'failed'

export type DeleteExplorerItemsOperationMetadata = {
  rootItemType: 'folder' | 'request'
  rootItemId: string
  rootItemName: string
  deletedAt: number
  folderIds: string[]
  requestIds: string[]
}

export type DeleteSharedScriptOperationMetadata = {
  sharedScriptId: string
  sharedScriptName: string
  deletedAt: number
}

export type OperationMetadata = DeleteExplorerItemsOperationMetadata | DeleteSharedScriptOperationMetadata

export type OperationRecord = {
  id: string
  operationType: OperationType
  status: OperationStatus
  title: string
  summary: string
  metadata: OperationMetadata
  createdAt: number
  updatedAt: number
  completedAt: number | null
  undoneAt: number | null
}

export type ListOperationsInput = {
  searchQuery?: string
  statuses?: OperationStatus[]
}

export type UndoOperationInput = {
  id: string
}

export type DeleteOperationInput = {
  id: string
}

export type UndoOperationsInput = {
  ids: string[]
}

export type DeleteOperationsInput = {
  ids: string[]
}
