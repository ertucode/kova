import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { AUTH_LOCATIONS } from '../../common/Auth.js'
import {
  type ManagementAgentFolderPlanItem,
  type ManagementAgentPlan,
  type ManagementAgentRequestCreatePlanItem,
  normalizeManagementAgentPlan,
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
  RESPONSE_BODY_VIEWS,
} from '../../common/ManagementAgent.js'
import {
  clearCurrentManagementAgentDraftPlan,
  getCurrentManagementAgentDraftPlan,
  setCurrentManagementAgentDraftPlan,
} from '../db/management-agent.js'
import type { ManagementAgentMcpContext } from './context.js'
import { nullableFolderIdSchema, parentScopeSchema } from './explorer-tools.js'

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('noauth') }),
  z.object({
    type: z.literal('bearer'),
    token: z.string(),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal('apikey'),
    key: z.string(),
    value: z.string(),
    addTo: z.enum(AUTH_LOCATIONS),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
])
const questionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string(),
  details: z.string(),
})
const warningSchema = z.object({
  id: z.string().trim().min(1),
  message: z.string(),
})
const folderPlanItemSchema = z.object({
  id: z.string().trim().min(1),
  parentFolderId: nullableFolderIdSchema,
  parentScope: parentScopeSchema,
  name: z.string(),
})
const requestPlanFieldsSchema = z.object({
  name: z.string(),
  method: z.enum(REQUEST_METHODS),
  url: z.string(),
  pathParams: z.string(),
  searchParams: z.string(),
  auth: authSchema,
  headers: z.string(),
  body: z.string(),
  bodyType: z.enum(REQUEST_BODY_TYPES),
  rawType: z.enum(REQUEST_RAW_TYPES),
  graphqlQuery: z.string(),
  graphqlVariables: z.string(),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
  testScript: z.string(),
  responseVisualizer: z.string(),
  responseTableAccessor: z.string(),
  preferredResponseBodyView: z.enum(RESPONSE_BODY_VIEWS),
  saveToHistory: z.boolean(),
})
const requestCreatePlanItemSchema = requestPlanFieldsSchema.extend({
  id: z.string().trim().min(1),
  parentFolderId: nullableFolderIdSchema,
  parentScope: parentScopeSchema,
})
const requestUpdatePlanItemSchema = requestPlanFieldsSchema.extend({
  requestId: z.string().trim().min(1),
})
const environmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
})
const environmentUpdateSchema = z.object({
  environmentId: z.string().trim().min(1),
  environmentName: z.string(),
  variables: z.array(environmentVariableSchema),
})
const draftItemIdSchema = z.object({
  id: z.string().trim().min(1),
})
const requestUpdateRemovalSchema = z.object({
  requestId: z.string().trim().min(1),
})
const environmentUpdateRemovalSchema = z.object({
  environmentId: z.string().trim().min(1),
})
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
const managementAgentPlanSchema = z.object({
  summary: z.string(),
  questions: z.array(questionSchema),
  warnings: z.array(warningSchema),
  foldersToCreate: z.array(folderPlanItemSchema),
  requestsToCreate: z.array(requestCreatePlanItemSchema),
  requestsToUpdate: z.array(requestUpdatePlanItemSchema),
  environmentUpdates: z.array(environmentUpdateSchema),
  tagsToCreate: z.array(tagCreatePlanItemSchema).optional(),
  tagsToUpdate: z.array(tagUpdatePlanItemSchema).optional(),
  itemTagUpdates: z.array(itemTagUpdatePlanItemSchema).optional(),
  tagItemUpdates: z.array(tagItemUpdatePlanItemSchema).optional(),
})

export function registerDraftTools(server: McpServer, context: ManagementAgentMcpContext) {
  server.registerTool(
    'set_draft_summary',
    {
      description: 'Set the draft summary text without changing other draft sections.',
      inputSchema: {
        summary: z.string().describe('Short human summary of the planned changes.'),
      },
    },
    ({ summary }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          summary,
        },
        result: { summary },
      }))
  )

  server.registerTool(
    'set_draft_questions',
    {
      description: 'Replace the draft questions section without changing other draft sections.',
      inputSchema: {
        questions: z.array(questionSchema).describe('Complete list of draft questions to keep.'),
      },
    },
    ({ questions }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          questions,
        },
        result: { questions },
      }))
  )

  server.registerTool(
    'set_draft_warnings',
    {
      description: 'Replace the draft warnings section without changing other draft sections.',
      inputSchema: {
        warnings: z.array(warningSchema).describe('Complete list of draft warnings to keep.'),
      },
    },
    ({ warnings }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          warnings,
        },
        result: { warnings },
      }))
  )

  server.registerTool(
    'plan_add_folder',
    {
      description: 'Plan creation of a folder in the current draft.',
      inputSchema: folderPlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          foldersToCreate: overwriteBy(draft.foldersToCreate, input, folder => folder.id),
        },
        result: { plannedFolder: input },
      }))
  )

  server.registerTool(
    'plan_add_request',
    {
      description: 'Plan creation of a request in the current draft.',
      inputSchema: requestCreatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          requestsToCreate: overwriteBy(draft.requestsToCreate, input, request => request.id),
        },
        result: { plannedRequest: input },
      }))
  )

  server.registerTool(
    'plan_update_request',
    {
      description: 'Plan an update to an existing request in the current draft.',
      inputSchema: requestUpdatePlanItemSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          requestsToUpdate: overwriteBy(draft.requestsToUpdate, input, request => request.requestId),
        },
        result: { plannedRequestUpdate: input },
      }))
  )

  server.registerTool(
    'plan_set_environment_update',
    {
      description: 'Plan the full variable update for one environment in the current draft.',
      inputSchema: environmentUpdateSchema,
    },
    input =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          environmentUpdates: overwriteBy(draft.environmentUpdates, input, environment => environment.environmentId),
        },
        result: { plannedEnvironmentUpdate: input },
      }))
  )

  server.registerTool(
    'plan_remove_folder_creation',
    {
      description:
        'Remove a planned folder creation from the current draft and cascade to planned child folders and planned requests inside that folder subtree.',
      inputSchema: draftItemIdSchema,
    },
    ({ id }) =>
      context.updateDraft(draft => removeFolderCreationFromDraft(draft, id))
  )

  server.registerTool(
    'plan_remove_request_creation',
    {
      description: 'Remove a planned request creation from the current draft.',
      inputSchema: draftItemIdSchema,
    },
    ({ id }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          requestsToCreate: removeOneByOrThrow(draft.requestsToCreate, id, request => request.id, 'Planned request creation not found.'),
        },
        result: { removedRequestId: id },
      }))
  )

  server.registerTool(
    'plan_remove_request_update',
    {
      description: 'Remove a planned request update from the current draft.',
      inputSchema: requestUpdateRemovalSchema,
    },
    ({ requestId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          requestsToUpdate: removeOneByOrThrow(
            draft.requestsToUpdate,
            requestId,
            request => request.requestId,
            'Planned request update not found.'
          ),
        },
        result: { removedRequestId: requestId },
      }))
  )

  server.registerTool(
    'plan_remove_environment_update',
    {
      description: 'Remove a planned environment update from the current draft.',
      inputSchema: environmentUpdateRemovalSchema,
    },
    ({ environmentId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          environmentUpdates: removeOneByOrThrow(
            draft.environmentUpdates,
            environmentId,
            update => update.environmentId,
            'Planned environment update not found.'
          ),
        },
        result: { removedEnvironmentId: environmentId },
      }))
  )

  server.registerTool(
    'get_current_draft',
    {
      description: 'Get the current draft plan for a session.',
      inputSchema: {},
    },
    async () => {
      context.requireSession()
      return context.toToolResult({ draft: getCurrentManagementAgentDraftPlan(context.requireSessionId()) })
    }
  )

  server.registerTool(
    'set_current_draft',
    {
      description: 'Replace the entire current draft plan for a session.',
      inputSchema: {
        plan: managementAgentPlanSchema.describe('Complete draft plan object to set as the current draft'),
      },
    },
    async ({ plan }) => {
      context.requireSession()
      return context.toToolResult({
        draft: setCurrentManagementAgentDraftPlan(context.requireSessionId(), normalizeManagementAgentPlan(plan)),
      })
    }
  )

  server.registerTool(
    'clear_current_draft',
    {
      description: 'Clear the current draft plan for a session.',
      inputSchema: {},
    },
    async () => {
      context.requireSession()
      clearCurrentManagementAgentDraftPlan(context.requireSessionId())
      return context.toToolResult({ success: true })
    }
  )
}

function overwriteBy<T>(items: T[], nextItem: T, getKey: (item: T) => string) {
  const nextKey = getKey(nextItem)
  return [...items.filter(item => getKey(item) !== nextKey), nextItem]
}

export function removeFolderCreationFromDraft(draft: ManagementAgentPlan, id: string) {
  const removedFolderIds = getRemovedFolderCreationIds(draft, id)
  const removedRequestIds = draft.requestsToCreate
    .filter(request => request.parentFolderId !== null && removedFolderIds.has(request.parentFolderId))
    .map(request => request.id)

  return {
    draft: {
      ...draft,
      foldersToCreate: draft.foldersToCreate.filter(folder => !removedFolderIds.has(folder.id)),
      requestsToCreate: draft.requestsToCreate.filter(request => !removedRequestIds.includes(request.id)),
    },
    result: {
      removedFolderIds: Array.from(removedFolderIds),
      removedRequestIds,
    },
  }
}

function removeOneByOrThrow<T>(items: T[], targetKey: string, getKey: (item: T) => string, errorMessage: string) {
  const exists = items.some(item => getKey(item) === targetKey)
  if (!exists) {
    throw new Error(errorMessage)
  }

  return items.filter(item => getKey(item) !== targetKey)
}

function getRemovedFolderCreationIds(draft: ManagementAgentPlan, rootFolderId: string) {
  const rootFolder = draft.foldersToCreate.find(folder => folder.id === rootFolderId)
  if (!rootFolder) {
    throw new Error('Planned folder creation not found.')
  }

  const childFoldersByParentId = new Map<string, ManagementAgentFolderPlanItem[]>()
  draft.foldersToCreate.forEach(folder => {
    if (folder.parentFolderId === null) {
      return
    }

    const siblings = childFoldersByParentId.get(folder.parentFolderId) ?? []
    siblings.push(folder)
    childFoldersByParentId.set(folder.parentFolderId, siblings)
  })

  const removedFolderIds = new Set<string>()
  const pendingFolderIds = [rootFolder.id]

  while (pendingFolderIds.length > 0) {
    const currentFolderId = pendingFolderIds.pop()
    if (!currentFolderId || removedFolderIds.has(currentFolderId)) {
      continue
    }

    removedFolderIds.add(currentFolderId)
    const childFolders = childFoldersByParentId.get(currentFolderId) ?? []
    childFolders.forEach(folder => pendingFolderIds.push(folder.id))
  }

  return removedFolderIds
}
