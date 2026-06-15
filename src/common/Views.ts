export const VIEW_LAYOUT_MODES = ['horizontal', 'vertical'] as const

export type ViewLayoutMode = (typeof VIEW_LAYOUT_MODES)[number]

export type ViewShortcut = {
  code: string
  metaKey?: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
}

export type ViewRecord = {
  id: string
  name: string
  code: string
  shortcut: ViewShortcut | null
  showCodeEditor: boolean
  showRuntimePreview: boolean
  layoutMode: ViewLayoutMode
  splitRatio: number
  rememberRequests: boolean
  position: number
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type CreateViewInput = {
  name: string
  code?: string
  shortcut?: ViewShortcut | null
  showCodeEditor?: boolean
  showRuntimePreview?: boolean
  layoutMode?: ViewLayoutMode
  splitRatio?: number
  rememberRequests?: boolean
}

export type UpdateViewInput = {
  id: string
  name: string
  code: string
  shortcut: ViewShortcut | null
  showCodeEditor: boolean
  showRuntimePreview: boolean
  layoutMode: ViewLayoutMode
  splitRatio: number
  rememberRequests: boolean
}

export type DeleteViewInput = {
  id: string
}

export type MoveViewInput = {
  id: string
  targetPosition: number
}
