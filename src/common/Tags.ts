import { normalizeEnvironmentColor } from './Environments.js'

export type TaggableItemType = 'folder' | 'request'

export type TagRecord = {
  id: string
  name: string
  color: string | null
  position: number
  createdAt: number
  deletedAt: number | null
}

export type TagAssignmentRecord = {
  id: string
  tagId: string
  itemType: TaggableItemType
  itemId: string
  createdAt: number
}

export type CreateTagInput = {
  name: string
  color?: string | null
}

export type UpdateTagInput = {
  id: string
  name: string
  color: string | null
}

export type DeleteTagInput = {
  id: string
}

export type MoveTagInput = {
  id: string
  targetPosition: number
}

export type ReplaceItemTagsInput = {
  itemType: TaggableItemType
  itemId: string
  tagIds: string[]
}

export type ReplaceTagItemsInput = {
  tagId: string
  items: Array<{
    itemType: TaggableItemType
    itemId: string
  }>
}

export function normalizeTagColor(value: string | null | undefined): string | null {
  return normalizeEnvironmentColor(value)
}
