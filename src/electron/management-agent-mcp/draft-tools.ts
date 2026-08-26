import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { AUTH_LOCATIONS } from '../../common/Auth.js'
import { FOLDER_REQUEST_EXECUTION_MODES, FOLDER_REQUEST_SELECTION_MODES } from '../../common/FolderRuns.js'
import { Typescript } from '../../common/Typescript.js'
import {
  type ManagementAgentFolderUpdatePlanItem,
  type ManagementAgentFolderPlanItem,
  type ManagementAgentPlan,
  type ManagementAgentRequestUpdatePlanItem,
  normalizeManagementAgentPlan,
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
  RESPONSE_BODY_VIEWS,
} from '../../common/ManagementAgent.js'
import { REQUEST_TLS_VERIFICATION_MODES } from '../../common/Requests.js'
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
const folderRunConfigSchema = z.object({
  selectionMode: z.enum(FOLDER_REQUEST_SELECTION_MODES),
  selectedRequestIds: z.array(z.string().trim().min(1)),
  executionMode: z.enum(FOLDER_REQUEST_EXECUTION_MODES),
  continueOnFailure: z.boolean(),
})
const folderUpdatePlanItemSchema = z.object({
  folderId: z.string().trim().min(1),
  name: z.string(),
  description: z.string(),
  headers: z.string(),
  auth: authSchema,
  preRequestScript: z.string(),
  postRequestScript: z.string(),
  runConfig: folderRunConfigSchema,
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
  tlsVerificationMode: z.enum(REQUEST_TLS_VERIFICATION_MODES),
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
const requestFieldChangeSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('name'), value: z.string() }),
  z.object({ field: z.literal('method'), value: z.enum(REQUEST_METHODS) }),
  z.object({ field: z.literal('url'), value: z.string() }),
  z.object({ field: z.literal('pathParams'), value: z.string() }),
  z.object({ field: z.literal('searchParams'), value: z.string() }),
  z.object({ field: z.literal('auth'), value: authSchema }),
  z.object({ field: z.literal('headers'), value: z.string() }),
  z.object({ field: z.literal('body'), value: z.string() }),
  z.object({ field: z.literal('bodyType'), value: z.enum(REQUEST_BODY_TYPES) }),
  z.object({ field: z.literal('rawType'), value: z.enum(REQUEST_RAW_TYPES) }),
  z.object({ field: z.literal('graphqlQuery'), value: z.string() }),
  z.object({ field: z.literal('graphqlVariables'), value: z.string() }),
  z.object({ field: z.literal('preRequestScript'), value: z.string() }),
  z.object({ field: z.literal('postRequestScript'), value: z.string() }),
  z.object({ field: z.literal('testScript'), value: z.string() }),
  z.object({ field: z.literal('responseVisualizer'), value: z.string() }),
  z.object({ field: z.literal('responseTableAccessor'), value: z.string() }),
  z.object({ field: z.literal('preferredResponseBodyView'), value: z.enum(RESPONSE_BODY_VIEWS) }),
  z.object({ field: z.literal('tlsVerificationMode'), value: z.enum(REQUEST_TLS_VERIFICATION_MODES) }),
  z.object({ field: z.literal('saveToHistory'), value: z.boolean() }),
])
const requestFieldChangeListSchema = z.object({
  requestId: z.string().trim().min(1),
  changes: z.array(requestFieldChangeSchema).min(1).describe('Only include fields that should change. Do not include unchanged fields.'),
})
type RequestFieldChange = z.infer<typeof requestFieldChangeSchema>
const requestDeletePlanItemSchema = z.object({
  requestId: z.string().trim().min(1),
})
const folderDeletePlanItemSchema = z.object({
  folderId: z.string().trim().min(1),
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
  foldersToUpdate: z.array(folderUpdatePlanItemSchema).optional(),
  requestsToCreate: z.array(requestCreatePlanItemSchema),
  requestsToUpdate: z.array(requestPlanFieldsSchema.partial().extend({ requestId: z.string().trim().min(1) })),
  requestsToDelete: z.array(requestDeletePlanItemSchema).optional(),
  foldersToDelete: z.array(folderDeletePlanItemSchema).optional(),
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
    'plan_update_folder',
    {
      description: 'Plan an update to an existing folder in the current draft.',
      inputSchema: folderUpdatePlanItemSchema,
    },
    input => context.updateDraft(draft => planFolderUpdateOnDraft(draft, input))
  )

  server.registerTool(
    'plan_remove_folder_update',
    {
      description: 'Remove a planned folder update from the current draft.',
      inputSchema: {
        folderId: z.string().trim().min(1),
      },
    },
    ({ folderId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          foldersToUpdate: removeOneByOrThrow(
            draft.foldersToUpdate,
            folderId,
            folder => folder.folderId,
            'Planned folder update not found.'
          ),
        },
        result: { removedFolderId: folderId },
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
      description: 'Plan a full replacement update to an existing request. Send every editable request field. If only some fields should change, use plan_change_request_fields instead.',
      inputSchema: requestUpdatePlanItemSchema,
    },
    input => context.updateDraft(draft => planRequestUpdateOnDraft(draft, input))
  )

  server.registerTool(
    'plan_change_request_fields',
    {
      description: 'Plan changes to specific request fields only. Do not send unchanged fields. Each change must name one field and its new value.',
      inputSchema: requestFieldChangeListSchema,
    },
    input => context.updateDraft(draft => planRequestUpdateOnDraft(draft, requestFieldChangesToUpdatePlanItem(input)))
  )

  server.registerTool(
    'plan_delete_request',
    {
      description: 'Plan deletion of an existing request from the workspace.',
      inputSchema: requestDeletePlanItemSchema,
    },
    input => context.updateDraft(draft => planRequestDeletionOnDraft(draft, input.requestId))
  )

  server.registerTool(
    'plan_delete_folder',
    {
      description: 'Plan deletion of an existing folder from the workspace.',
      inputSchema: folderDeletePlanItemSchema,
    },
    input => context.updateDraft(draft => planFolderDeletionOnDraft(draft, input.folderId))
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
    'plan_remove_request_deletion',
    {
      description: 'Remove a planned request deletion from the current draft.',
      inputSchema: requestDeletePlanItemSchema,
    },
    ({ requestId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          requestsToDelete: removeOneByOrThrow(
            draft.requestsToDelete,
            requestId,
            request => request.requestId,
            'Planned request deletion not found.'
          ),
        },
        result: { removedRequestId: requestId },
      }))
  )

  server.registerTool(
    'plan_remove_folder_deletion',
    {
      description: 'Remove a planned folder deletion from the current draft.',
      inputSchema: folderDeletePlanItemSchema,
    },
    ({ folderId }) =>
      context.updateDraft(draft => ({
        draft: {
          ...draft,
          foldersToDelete: removeOneByOrThrow(
            draft.foldersToDelete,
            folderId,
            folder => folder.folderId,
            'Planned folder deletion not found.'
          ),
        },
        result: { removedFolderId: folderId },
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

export function planFolderUpdateOnDraft(draft: ManagementAgentPlan, input: ManagementAgentFolderUpdatePlanItem) {
  return {
    draft: {
      ...draft,
      foldersToUpdate: overwriteBy(draft.foldersToUpdate, input, folder => folder.folderId),
      foldersToDelete: draft.foldersToDelete.filter(folder => folder.folderId !== input.folderId),
    },
    result: { plannedFolderUpdate: input },
  }
}

export function planRequestDeletionOnDraft(draft: ManagementAgentPlan, requestId: string) {
  return {
    draft: {
      ...draft,
      requestsToUpdate: draft.requestsToUpdate.filter(request => request.requestId !== requestId),
      requestsToDelete: overwriteBy(draft.requestsToDelete, { requestId }, request => request.requestId),
    },
    result: { plannedRequestDeletion: { requestId } },
  }
}

export function planFolderDeletionOnDraft(draft: ManagementAgentPlan, folderId: string) {
  return {
    draft: {
      ...draft,
      foldersToUpdate: draft.foldersToUpdate.filter(folder => folder.folderId !== folderId),
      foldersToDelete: overwriteBy(draft.foldersToDelete, { folderId }, folder => folder.folderId),
    },
    result: { plannedFolderDeletion: { folderId } },
  }
}

export function planRequestUpdateOnDraft(draft: ManagementAgentPlan, input: typeof draft.requestsToUpdate[number]) {
  return {
    draft: {
      ...draft,
      requestsToUpdate: overwriteBy(draft.requestsToUpdate, input, request => request.requestId),
    },
    result: { plannedRequestUpdate: input },
  }
}

export function requestFieldChangesToUpdatePlanItem(input: {
  requestId: string
  changes: RequestFieldChange[]
}): ManagementAgentRequestUpdatePlanItem {
  const nextUpdate: ManagementAgentRequestUpdatePlanItem = { requestId: input.requestId }
  const seenFields = new Set<string>()

  for (const change of input.changes) {
    if (seenFields.has(change.field)) {
      throw new Error(`Duplicate request field change "${change.field}".`)
    }

    seenFields.add(change.field)
    assignRequestFieldChange(nextUpdate, change)
  }

  return nextUpdate
}

function assignRequestFieldChange(target: ManagementAgentRequestUpdatePlanItem, change: RequestFieldChange) {
  switch (change.field) {
    case 'name':
      target.name = change.value
      return
    case 'method':
      target.method = change.value
      return
    case 'url':
      target.url = change.value
      return
    case 'pathParams':
      target.pathParams = change.value
      return
    case 'searchParams':
      target.searchParams = change.value
      return
    case 'auth':
      target.auth = change.value
      return
    case 'headers':
      target.headers = change.value
      return
    case 'body':
      target.body = change.value
      return
    case 'bodyType':
      target.bodyType = change.value
      return
    case 'rawType':
      target.rawType = change.value
      return
    case 'graphqlQuery':
      target.graphqlQuery = change.value
      return
    case 'graphqlVariables':
      target.graphqlVariables = change.value
      return
    case 'preRequestScript':
      target.preRequestScript = change.value
      return
    case 'postRequestScript':
      target.postRequestScript = change.value
      return
    case 'testScript':
      target.testScript = change.value
      return
    case 'responseVisualizer':
      target.responseVisualizer = change.value
      return
    case 'responseTableAccessor':
      target.responseTableAccessor = change.value
      return
    case 'preferredResponseBodyView':
      target.preferredResponseBodyView = change.value
      return
    case 'tlsVerificationMode':
      target.tlsVerificationMode = change.value
      return
    case 'saveToHistory':
      target.saveToHistory = change.value
      return
    default:
      return Typescript.assertUnreachable(change)
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
