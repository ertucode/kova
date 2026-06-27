import { createDefaultHttpAuth, normalizeHttpAuth, type HttpAuth } from './Auth.js'
import {
  type RequestBodyType,
  type RequestMethod,
  type RequestRawType,
  type ResponseBodyView,
} from './Requests.js'
import type { ScriptAiMessage, ScriptAiMessagePart } from './ScriptAi.js'

export type ImportAgentScopeType = 'workspace' | 'folder'
export type ImportAgentSessionStatus = 'idle' | 'busy' | 'error'
export type ImportAgentPlanKind = 'draft' | 'applied'
export type ImportAgentPlanStatus = 'active' | 'applied' | 'superseded'

export type ImportAgentScope = {
  scopeType: ImportAgentScopeType
  targetFolderId: string | null
}

export type ImportAgentQuestion = {
  id: string
  label: string
  details: string
}

export type ImportAgentWarning = {
  id: string
  message: string
}

export type ImportAgentFolderPlanItem = {
  id: string
  parentFolderId: string | null
  name: string
}

export type ImportAgentRequestPlanFields = {
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

export type ImportAgentRequestCreatePlanItem = ImportAgentRequestPlanFields & {
  id: string
  parentFolderId: string | null
}

export type ImportAgentRequestUpdatePlanItem = ImportAgentRequestPlanFields & {
  requestId: string
}

export type ImportAgentEnvironmentVariablePlanItem = {
  key: string
  value: string
}

export type ImportAgentEnvironmentUpdatePlanItem = {
  environmentId: string
  environmentName: string
  variables: ImportAgentEnvironmentVariablePlanItem[]
}

export type ImportAgentPlan = {
  summary: string
  questions: ImportAgentQuestion[]
  warnings: ImportAgentWarning[]
  foldersToCreate: ImportAgentFolderPlanItem[]
  requestsToCreate: ImportAgentRequestCreatePlanItem[]
  requestsToUpdate: ImportAgentRequestUpdatePlanItem[]
  environmentUpdates: ImportAgentEnvironmentUpdatePlanItem[]
}

export type ImportAgentMessage = ScriptAiMessage
export type ImportAgentMessagePart = ScriptAiMessagePart

export type ImportAgentSessionSummary = ImportAgentScope & {
  id: string
  title: string
  opencodeSessionId: string | null
  selectedModel: string | null
  status: ImportAgentSessionStatus
  messageCount: number
  latestErrorMessage: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type ImportAgentPlanRecord = {
  id: string
  sessionId: string
  kind: ImportAgentPlanKind
  status: ImportAgentPlanStatus
  plan: ImportAgentPlan
  createdAt: number
  updatedAt: number
}

export type ImportAgentSessionState = {
  session: ImportAgentSessionSummary
  messages: ImportAgentMessage[]
  activePlan: ImportAgentPlanRecord | null
  appliedPlans: ImportAgentPlanRecord[]
}

export type ImportAgentWorkspaceState = ImportAgentScope & {
  sessions: ImportAgentSessionState[]
}

export type LoadImportAgentWorkspaceInput = ImportAgentScope

export type CreateImportAgentSessionInput = ImportAgentScope & {
  model: string | null
}

export type SendImportAgentMessageInput = {
  sessionId: string
  message: string
  model: string | null
}

export type AbortImportAgentSessionInput = {
  sessionId: string
}

export type ApplyImportAgentPlanInput = {
  sessionId: string
}

const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const REQUEST_BODY_TYPES: RequestBodyType[] = ['raw', 'form-data', 'x-www-form-urlencoded', 'none', 'graphql']
const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']
const RESPONSE_BODY_VIEWS: ResponseBodyView[] = ['raw', 'table', 'visualizer']

export function createEmptyImportAgentPlan(): ImportAgentPlan {
  return {
    summary: '',
    questions: [],
    warnings: [],
    foldersToCreate: [],
    requestsToCreate: [],
    requestsToUpdate: [],
    environmentUpdates: [],
  }
}

export function normalizeImportAgentPlan(value: unknown): ImportAgentPlan {
  if (!value || typeof value !== 'object') {
    return createEmptyImportAgentPlan()
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
  }
}

function normalizeQuestion(value: unknown): ImportAgentQuestion {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    label: toTrimmedString(candidate.label),
    details: toTrimmedString(candidate.details),
  }
}

function normalizeWarning(value: unknown): ImportAgentWarning {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    message: toTrimmedString(candidate.message),
  }
}

function normalizeFolderPlanItem(value: unknown): ImportAgentFolderPlanItem {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    parentFolderId: toNullableTrimmedString(candidate.parentFolderId),
    name: toTrimmedString(candidate.name),
  }
}

function normalizeRequestCreatePlanItem(value: unknown): ImportAgentRequestCreatePlanItem {
  const candidate = toRecord(value)
  return {
    id: toOptionalTrimmedString(candidate.id) ?? crypto.randomUUID(),
    parentFolderId: toNullableTrimmedString(candidate.parentFolderId),
    ...normalizeRequestPlanFields(candidate),
  }
}

function normalizeRequestUpdatePlanItem(value: unknown): ImportAgentRequestUpdatePlanItem {
  const candidate = toRecord(value)
  return {
    requestId: toTrimmedString(candidate.requestId),
    ...normalizeRequestPlanFields(candidate),
  }
}

function normalizeRequestPlanFields(candidate: Record<string, unknown>): ImportAgentRequestPlanFields {
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

function normalizeEnvironmentUpdatePlanItem(value: unknown): ImportAgentEnvironmentUpdatePlanItem {
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

export function createDefaultImportAgentRequestPlanFields(): ImportAgentRequestPlanFields {
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
