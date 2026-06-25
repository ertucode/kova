import type { OperationRecord } from './Operations.js'

export const SHARED_SCRIPT_SCOPE_TYPES = ['workspace', 'folder'] as const
export type SharedScriptScopeType = (typeof SHARED_SCRIPT_SCOPE_TYPES)[number]

export const SHARED_SCRIPT_KINDS = ['global', 'module'] as const
export type SharedScriptKind = (typeof SHARED_SCRIPT_KINDS)[number]

export const SHARED_SCRIPT_TARGETS = ['pre-request', 'post-request', 'test', 'response-visualizer', 'view-runtime'] as const
export type SharedScriptTarget = (typeof SHARED_SCRIPT_TARGETS)[number]

export type SharedScriptRecord = {
  id: string
  scopeType: SharedScriptScopeType
  scopeId: string | null
  name: string
  kind: SharedScriptKind
  targets: SharedScriptTarget[]
  isActive: boolean
  code: string
  position: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ListSharedScriptsInput = {
  scopeType: SharedScriptScopeType
  scopeId: string | null
}

export type ListVisibleSharedScriptsInput = {
  folderId: string | null
}

export type CreateSharedScriptInput = {
  scopeType: SharedScriptScopeType
  scopeId: string | null
  name: string
  kind: SharedScriptKind
  targets: SharedScriptTarget[]
  isActive: boolean
  code?: string
}

export type UpdateSharedScriptInput = {
  id: string
  name: string
  kind: SharedScriptKind
  targets: SharedScriptTarget[]
  isActive: boolean
  code: string
}

export type DeleteSharedScriptInput = {
  id: string
}

export type DeleteSharedScriptResponse = {
  operation: OperationRecord
}

export type MoveSharedScriptInput = {
  id: string
  targetPosition: number
}
