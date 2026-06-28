import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ManagementAgentPlan } from '../../common/ManagementAgent.js'
import { listExplorerItems } from '../db/explorer.js'
import { listTagAssignments, listTags } from '../db/tags.js'
import type { ManagementAgentMcpContext } from './context.js'
import { addExplorerPaths } from './explorer-tools.js'

const tagIdSchema = z.string().trim().min(1)
const tagNameSchema = z.string()
const tagColorSchema = z.string().trim().min(1).nullable()
const taggableItemTypeSchema = z.enum(['folder', 'request'])
const tagItemRefSchema = z.object({
  itemType: taggableItemTypeSchema,
  itemId: z.string().trim().min(1),
})
const tagCreatePlanItemSchema = z.object({
  id: tagIdSchema,
  name: tagNameSchema,
  color: tagColorSchema,
})
const tagUpdatePlanItemSchema = z.object({
  tagId: tagIdSchema,
  name: tagNameSchema,
  color: tagColorSchema,
})
const itemTagUpdatePlanItemSchema = z.object({
  itemType: taggableItemTypeSchema,
  itemId: z.string().trim().min(1),
  tagIds: z.array(tagIdSchema),
})
const tagItemUpdatePlanItemSchema = z.object({
  tagId: tagIdSchema,
  items: z.array(tagItemRefSchema),
})
const draftItemIdSchema = z.object({
  id: z.string().trim().min(1),
})

export function registerTagTools(server: McpServer, context: ManagementAgentMcpContext) {
  server.registerTool(
    'list_tags',
    {
      description: 'List all tags available to the management agent.',
      inputSchema: {},
    },
    async () => {
      context.requireSession()
      return context.toToolResult({ tags: await listTags() })
    }
  )

  server.registerTool(
    'get_tag_details',
    {
      description: 'Get a tag, its direct assignments, and tagged explorer items by tag ID.',
      inputSchema: {
        tagId: tagIdSchema.describe('Tag ID to load'),
      },
    },
    async ({ tagId }) => {
      context.requireSession()
      const [tags, assignments, explorerItems] = await Promise.all([listTags(), listTagAssignments(), listExplorerItems()])
      const tag = tags.find(currentTag => currentTag.id === tagId) ?? null
      if (!tag) {
        throw new Error('Tag not found.')
      }

      const tagAssignments = assignments.filter(assignment => assignment.tagId === tagId)
      return context.toToolResult({
        tag,
        assignments: tagAssignments,
        items: getTaggedExplorerItems(tagAssignments, explorerItems),
      })
    }
  )

  server.registerTool(
    'list_explorer_items_by_tag_id',
    {
      description: 'List directly tagged folders and requests by tag ID.',
      inputSchema: {
        tagId: tagIdSchema.describe('Tag ID to list explorer items for'),
      },
    },
    async ({ tagId }) => {
      context.requireSession()
      const [tags, assignments, explorerItems] = await Promise.all([listTags(), listTagAssignments(), listExplorerItems()])
      const tag = tags.find(currentTag => currentTag.id === tagId) ?? null
      if (!tag) {
        throw new Error('Tag not found.')
      }

      const tagAssignments = assignments.filter(assignment => assignment.tagId === tagId)
      return context.toToolResult({ tag, items: getTaggedExplorerItems(tagAssignments, explorerItems) })
    }
  )

  server.registerTool(
    'plan_add_tag',
    {
      description: 'Plan creation of a new tag in the current draft.',
      inputSchema: tagCreatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          tagsToCreate: overwriteBy(draft.tagsToCreate, input, tag => tag.id),
        },
        result: { plannedTag: input },
      }))
  )

  server.registerTool(
    'plan_update_tag',
    {
      description: 'Plan an update to an existing tag in the current draft.',
      inputSchema: tagUpdatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          tagsToUpdate: overwriteBy(draft.tagsToUpdate, input, tag => tag.tagId),
        },
        result: { plannedTagUpdate: input },
      }))
  )

  server.registerTool(
    'plan_replace_item_tags',
    {
      description: 'Plan replacement of all tags on a folder or request.',
      inputSchema: itemTagUpdatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          itemTagUpdates: overwriteBy(draft.itemTagUpdates, input, item => `${item.itemType}:${item.itemId}`),
        },
        result: { plannedItemTagUpdate: input },
      }))
  )

  server.registerTool(
    'plan_replace_tag_items',
    {
      description: 'Plan replacement of all items assigned to a tag.',
      inputSchema: tagItemUpdatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          tagItemUpdates: overwriteBy(draft.tagItemUpdates, input, item => item.tagId),
        },
        result: { plannedTagItemUpdate: input },
      }))
  )

  server.registerTool(
    'plan_remove_tag_creation',
    {
      description:
        'Remove a planned tag creation from the current draft and cascade to draft tag references that target that planned tag.',
      inputSchema: draftItemIdSchema,
    },
    ({ id }) =>
      context.updateDraft(draft => removeTagCreationFromDraft(draft, id))
  )

  server.registerTool(
    'plan_remove_tag_update',
    {
      description: 'Remove a planned tag update from the current draft.',
      inputSchema: {
        tagId: tagIdSchema.describe('Existing tag ID whose planned update should be removed.'),
      },
    },
    ({ tagId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          tagsToUpdate: removeOneByOrThrow(draft.tagsToUpdate, tagId, tag => tag.tagId, 'Planned tag update not found.'),
        },
        result: { removedTagId: tagId },
      }))
  )
}

function getTaggedExplorerItems(
  assignments: Awaited<ReturnType<typeof listTagAssignments>>,
  explorerItems: Awaited<ReturnType<typeof listExplorerItems>>
) {
  const itemKeys = new Set(assignments.map(assignment => `${assignment.itemType}:${assignment.itemId}`))
  return addExplorerPaths(
    explorerItems.filter(
      (item): item is Extract<(typeof explorerItems)[number], { itemType: 'folder' | 'request' }> =>
        (item.itemType === 'folder' || item.itemType === 'request') && itemKeys.has(`${item.itemType}:${item.id}`)
    ),
    explorerItems
  )
}

function overwriteBy<T>(items: T[], nextItem: T, getKey: (item: T) => string) {
  const nextKey = getKey(nextItem)
  return [...items.filter(item => getKey(item) !== nextKey), nextItem]
}

function removeOneByOrThrow<T>(items: T[], targetKey: string, getKey: (item: T) => string, errorMessage: string) {
  ensureDraftCreationExists(items.map(getKey), targetKey, errorMessage)
  return items.filter(item => getKey(item) !== targetKey)
}

function ensureDraftCreationExists(keys: string[], targetKey: string, errorMessage: string) {
  if (!keys.includes(targetKey)) {
    throw new Error(errorMessage)
  }
}

export function removeTagCreationFromDraft(draft: ManagementAgentPlan, removedTagId: string) {
  ensureDraftCreationExists(draft.tagsToCreate.map(tag => tag.id), removedTagId, 'Planned tag creation not found.')
  const nextDraft = removeTagReferencesFromDraft(draft, removedTagId)
  return {
    draft: {
      ...nextDraft,
      tagsToCreate: nextDraft.tagsToCreate.filter(tag => tag.id !== removedTagId),
    },
    result: {
      removedTagId,
      removedTagItemUpdateIds: draft.tagItemUpdates.filter(update => update.tagId === removedTagId).map(update => update.tagId),
      cleanedItemTagUpdateKeys: draft.itemTagUpdates
        .filter(update => update.tagIds.includes(removedTagId))
        .map(update => `${update.itemType}:${update.itemId}`),
    },
  }
}

function removeTagReferencesFromDraft(draft: ManagementAgentPlan, removedTagId: string): ManagementAgentPlan {
  return {
    ...draft,
    itemTagUpdates: draft.itemTagUpdates
      .map(update => ({
        ...update,
        tagIds: update.tagIds.filter(tagId => tagId !== removedTagId),
      }))
      .filter(update => update.tagIds.length > 0),
    tagItemUpdates: draft.tagItemUpdates.filter(update => update.tagId !== removedTagId),
  }
}
