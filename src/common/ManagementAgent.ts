import { createDefaultHttpAuth, normalizeHttpAuth, type HttpAuth } from './Auth.js'
import {
  type RequestBodyType,
  type RequestMethod,
  type RequestRawType,
  type ResponseBodyView,
} from './Requests.js'
import type { ScriptAiMessage, ScriptAiMessagePart } from './ScriptAi.js'
import type { TaggableItemType } from './Tags.js'

export type ManagementAgentScopeType = 'workspace' | 'folder' | 'request'
export type ManagementAgentSessionStatus = 'idle' | 'busy' | 'error'
export type ManagementAgentPlanKind = 'draft' | 'applied'
export type ManagementAgentPlanStatus = 'active' | 'applied' | 'superseded'

export type ManagementAgentScope = {
  scopeType: ManagementAgentScopeType
  targetFolderId: string | null
  targetRequestId: string | null
}

export type ManagementAgentQuestion = {
  id: string
  label: string
  details: string
}

export type ManagementAgentWarning = {
  id: string
  message: string
}

export type ManagementAgentFolderPlanItem = {
  id: string
  parentFolderId: string | null
  parentScope?: ManagementAgentParentScope
  name: string
}

export type ManagementAgentParentScope = 'session-root' | 'workspace-root'

export type ManagementAgentRequestPlanFields = {
  name: string
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  graphqlQuery: string
  graphqlVariables: string
  preRequestScript: string
  postRequestScript: string
  testScript: string
  responseVisualizer: string
  responseTableAccessor: string
  preferredResponseBodyView: ResponseBodyView
  saveToHistory: boolean
}

export type ManagementAgentRequestCreatePlanItem = ManagementAgentRequestPlanFields & {
  id: string
  parentFolderId: string | null
  parentScope?: ManagementAgentParentScope
}

export type ManagementAgentRequestUpdatePlanItem = ManagementAgentRequestPlanFields & {
  requestId: string
}

export type ManagementAgentEnvironmentVariablePlanItem = {
  key: string
  value: string
}

export type ManagementAgentEnvironmentUpdatePlanItem = {
  environmentId: string
  environmentName: string
  variables: ManagementAgentEnvironmentVariablePlanItem[]
}

export type ManagementAgentTagCreatePlanItem = {
  id: string
  name: string
  color: string | null
}

export type ManagementAgentTagUpdatePlanItem = {
  tagId: string
  name: string
  color: string | null
}

export type ManagementAgentItemTagUpdatePlanItem = {
  itemType: TaggableItemType
  itemId: string
  tagIds: string[]
}

export type ManagementAgentTagItemUpdatePlanItem = {
  tagId: string
  items: Array<{
    itemType: TaggableItemType
    itemId: string
  }>
}

export type ManagementAgentPlan = {
  summary: string
  questions: ManagementAgentQuestion[]
  warnings: ManagementAgentWarning[]
  foldersToCreate: ManagementAgentFolderPlanItem[]
  requestsToCreate: ManagementAgentRequestCreatePlanItem[]
  requestsToUpdate: ManagementAgentRequestUpdatePlanItem[]
  environmentUpdates: ManagementAgentEnvironmentUpdatePlanItem[]
  tagsToCreate: ManagementAgentTagCreatePlanItem[]
  tagsToUpdate: ManagementAgentTagUpdatePlanItem[]
  itemTagUpdates: ManagementAgentItemTagUpdatePlanItem[]
  tagItemUpdates: ManagementAgentTagItemUpdatePlanItem[]
}

export type ManagementAgentMessage = ScriptAiMessage
export type ManagementAgentMessagePart = ScriptAiMessagePart

export type ManagementAgentSessionSummary = ManagementAgentScope & {
  id: string
  title: string
  opencodeSessionId: string | null
  selectedModel: string | null
  status: ManagementAgentSessionStatus
  messageCount: number
  latestErrorMessage: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ManagementAgentPlanRecord = {
  id: string
  sessionId: string
  kind: ManagementAgentPlanKind
  status: ManagementAgentPlanStatus
  plan: ManagementAgentPlan
  createdAt: number
  updatedAt: number
}

export type ManagementAgentSessionState = {
  session: ManagementAgentSessionSummary
  messages: ManagementAgentMessage[]
  activePlan: ManagementAgentPlanRecord | null
  appliedPlans: ManagementAgentPlanRecord[]
}

export type ManagementAgentWorkspaceState = ManagementAgentScope & {
  sessions: ManagementAgentSessionState[]
}

export type LoadManagementAgentWorkspaceInput = ManagementAgentScope

export type CreateManagementAgentSessionInput = ManagementAgentScope & {
  model: string | null
}

export type SendManagementAgentMessageInput = {
  sessionId: string
  message: string
  model: string | null
}

export type AbortManagementAgentSessionInput = {
  sessionId: string
}

export type ApplyManagementAgentPlanInput = {
  sessionId: string
}

export const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
export const REQUEST_BODY_TYPES: RequestBodyType[] = ['raw', 'form-data', 'x-www-form-urlencoded', 'none', 'graphql']
export const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']
export const RESPONSE_BODY_VIEWS: ResponseBodyView[] = ['raw', 'table', 'visualizer']

export function createEmptyManagementAgentPlan(): ManagementAgentPlan {
  return {
    summary: '',
    questions: [],
    warnings: [],
    foldersToCreate: [],
    requestsToCreate: [],
    requestsToUpdate: [],
    environmentUpdates: [],
    tagsToCreate: [],
    tagsToUpdate: [],
    itemTagUpdates: [],
    tagItemUpdates: [],
  }
}

export function normalizeManagementAgentPlan(value: unknown): ManagementAgentPlan {
  if (!value || typeof value !== 'object') {
    return createEmptyManagementAgentPlan()
  }

  const candidate = value as Record<string, unknown>

  return {
    summary: toTrimmedString(candidate.summary),
    questions: toArray(candidate.questions).map(normalizeQuestion).filter(question => question.label),
    warnings: toArray(candidate.warnings).map(normalizeWarning).filter(warning => warning.message),
    foldersToCreate: toArray(candidate.foldersToCreate).map(normalizeFolderPlanItem).filter(folder => folder.name),
    requestsToCreate: toArray(candidate.requestsToCreate)
      .map(normalizeRequestCreatePlanItem)
      .filter(request => request.name),
    requestsToUpdate: toArray(candidate.requestsToUpdate)
      .map(normalizeRequestUpdatePlanItem)
      .filter(request => request.requestId),
    environmentUpdates: toArray(candidate.environmentUpdates)
      .map(normalizeEnvironmentUpdatePlanItem)
      .filter(environmentUpdate => environmentUpdate.environmentId),
    tagsToCreate: toArray(candidate.tagsToCreate)
      .map(normalizeTagCreatePlanItem)
      .filter(tag => tag.name),
    tagsToUpdate: toArray(candidate.tagsToUpdate)
      .map(normalizeTagUpdatePlanItem)
      .filter(tag => tag.tagId),
    itemTagUpdates: toArray(candidate.itemTagUpdates)
      .map(normalizeItemTagUpdatePlanItem)
      .filter(itemTagUpdate => itemTagUpdate.itemId),
    tagItemUpdates: toArray(candidate.tagItemUpdates)
      .map(normalizeTagItemUpdatePlanItem)
      .filter(tagItemUpdate => tagItemUpdate.tagId),
  }
}

function normalizeQuestion(value: unknown): ManagementAgentQuestion {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    label: toTrimmedString(candidate.label),
    details: toTrimmedString(candidate.details),
  }
}

function normalizeWarning(value: unknown): ManagementAgentWarning {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    message: toTrimmedString(candidate.message),
  }
}

function normalizeFolderPlanItem(value: unknown): ManagementAgentFolderPlanItem {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    parentFolderId: toNullableTrimmedString(candidate.parentFolderId),
    parentScope: normalizeParentScope(candidate.parentScope),
    name: toTrimmedString(candidate.name),
  }
}

function normalizeRequestCreatePlanItem(value: unknown): ManagementAgentRequestCreatePlanItem {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    parentFolderId: toNullableTrimmedString(candidate.parentFolderId),
    parentScope: normalizeParentScope(candidate.parentScope),
    ...normalizeRequestPlanFields(candidate),
  }
}

function normalizeTagCreatePlanItem(value: unknown): ManagementAgentTagCreatePlanItem {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    name: toTrimmedString(candidate.name),
    color: toNullableTrimmedString(candidate.color),
  }
}

function normalizeTagUpdatePlanItem(value: unknown): ManagementAgentTagUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    tagId: toTrimmedString(candidate.tagId),
    name: toTrimmedString(candidate.name),
    color: toNullableTrimmedString(candidate.color),
  }
}

function normalizeItemTagUpdatePlanItem(value: unknown): ManagementAgentItemTagUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    itemType: normalizeTaggableItemType(candidate.itemType),
    itemId: toTrimmedString(candidate.itemId),
    tagIds: toArray(candidate.tagIds).map(toTrimmedString).filter(Boolean),
  }
}

function normalizeTagItemUpdatePlanItem(value: unknown): ManagementAgentTagItemUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    tagId: toTrimmedString(candidate.tagId),
    items: toArray(candidate.items)
      .map(normalizeTagItemRef)
      .filter(item => item.itemId),
  }
}

function normalizeTagItemRef(value: unknown): { itemType: TaggableItemType; itemId: string } {
  const candidate = toRecord(value)
  return {
    itemType: normalizeTaggableItemType(candidate.itemType),
    itemId: toTrimmedString(candidate.itemId),
  }
}

function normalizeRequestUpdatePlanItem(value: unknown): ManagementAgentRequestUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    requestId: toTrimmedString(candidate.requestId),
    ...normalizeRequestPlanFields(candidate),
  }
}

function normalizeRequestPlanFields(candidate: Record<string, unknown>): ManagementAgentRequestPlanFields {
  const method = toTrimmedString(candidate.method).toUpperCase()
  const bodyType = toTrimmedString(candidate.bodyType)
  const rawType = toTrimmedString(candidate.rawType)
  const preferredResponseBodyView = toTrimmedString(candidate.preferredResponseBodyView)

  return {
    name: toTrimmedString(candidate.name),
    method: REQUEST_METHODS.includes(method as RequestMethod) ? (method as RequestMethod) : 'GET',
    url: toTrimmedString(candidate.url),
    pathParams: toStringValue(candidate.pathParams),
    searchParams: toStringValue(candidate.searchParams),
    auth: normalizeHttpAuth(candidate.auth),
    headers: toStringValue(candidate.headers),
    body: toStringValue(candidate.body),
    bodyType: REQUEST_BODY_TYPES.includes(bodyType as RequestBodyType) ? (bodyType as RequestBodyType) : 'none',
    rawType: REQUEST_RAW_TYPES.includes(rawType as RequestRawType) ? (rawType as RequestRawType) : 'json',
    graphqlQuery: toStringValue(candidate.graphqlQuery),
    graphqlVariables: toStringValue(candidate.graphqlVariables),
    preRequestScript: toStringValue(candidate.preRequestScript),
    postRequestScript: toStringValue(candidate.postRequestScript),
    testScript: toStringValue(candidate.testScript),
    responseVisualizer: toStringValue(candidate.responseVisualizer),
    responseTableAccessor: toStringValue(candidate.responseTableAccessor),
    preferredResponseBodyView: RESPONSE_BODY_VIEWS.includes(preferredResponseBodyView as ResponseBodyView)
      ? (preferredResponseBodyView as ResponseBodyView)
      : 'raw',
    saveToHistory: typeof candidate.saveToHistory === 'boolean' ? candidate.saveToHistory : true,
  }
}

function normalizeParentScope(value: unknown): ManagementAgentParentScope | undefined {
  return value === 'session-root' || value === 'workspace-root' ? value : undefined
}

function normalizeTaggableItemType(value: unknown): TaggableItemType {
  return value === 'folder' ? 'folder' : 'request'
}

function normalizeEnvironmentUpdatePlanItem(value: unknown): ManagementAgentEnvironmentUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    environmentId: toTrimmedString(candidate.environmentId),
    environmentName: toTrimmedString(candidate.environmentName),
    variables: toArray(candidate.variables)
      .map(variable => {
        const item = toRecord(variable)
        return {
          key: toTrimmedString(item.key),
          value: toStringValue(item.value),
        }
      })
      .filter(variable => variable.key),
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function toTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function toOptionalTrimmedString(value: unknown) {
  const trimmed = toTrimmedString(value)
  return trimmed || null
}

function toNullableTrimmedString(value: unknown) {
  return value === null ? null : toOptionalTrimmedString(value)
}

export function createDefaultManagementAgentRequestPlanFields(): ManagementAgentRequestPlanFields {
  return {
    name: '',
    method: 'GET',
    url: '',
    pathParams: '',
    searchParams: '',
    auth: createDefaultHttpAuth(),
    headers: '',
    body: '',
    bodyType: 'none',
    rawType: 'json',
    graphqlQuery: '',
    graphqlVariables: '',
    preRequestScript: '',
    postRequestScript: '',
    testScript: '',
    responseVisualizer: '',
    responseTableAccessor: '',
    preferredResponseBodyView: 'raw',
    saveToHistory: true,
  }
}
