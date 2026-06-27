import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDefaultHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import {
  normalizeImportAgentPlan,
  type ImportAgentMessage,
  type ImportAgentPlan,
  type ImportAgentPlanRecord,
  type ImportAgentRequestCreatePlanItem,
  type ImportAgentRequestUpdatePlanItem,
  type ImportAgentScope,
  type ImportAgentScopeType,
  type ImportAgentSessionState,
  type ImportAgentSessionStatus,
  type ImportAgentWorkspaceState,
} from '../../common/ImportAgent.js'
import { getDb } from './index.js'
import { listExplorerItems } from './explorer.js'
import { environments, folders, importAgentPlans, importAgentSessions, requests, treeItems } from './schema.js'
import { parseKeyValueRows, stringifyKeyValueRows } from '../../common/KeyValueRows.js'

type Database = BetterSQLite3Database<any>
type ImportAgentSessionRow = typeof importAgentSessions.$inferSelect
type ImportAgentPlanRow = typeof importAgentPlans.$inferSelect

export async function createImportAgentSessionRecord(input: ImportAgentScope & { title: string; selectedModel: string | null }) {
  const db = getDb()
  const now = Date.now()
  const session: ImportAgentSessionRow = {
    id: crypto.randomUUID(),
    scopeType: input.scopeType,
    targetFolderId: input.targetFolderId,
    title: input.title,
    opencodeSessionId: null,
    selectedModel: input.selectedModel,
    status: 'idle',
    latestErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  db.insert(importAgentSessions).values(session).run()
  return await loadImportAgentWorkspaceState({ scopeType: input.scopeType, targetFolderId: input.targetFolderId })
}

export async function loadImportAgentWorkspaceState(
  scope: ImportAgentScope,
  options?: {
    messagesBySessionId?: Record<string, ImportAgentMessage[]>
  }
): Promise<ImportAgentWorkspaceState> {
  const db = getDb()
  const sessionRows = db
    .select()
    .from(importAgentSessions)
    .where(
      and(
        eq(importAgentSessions.scopeType, scope.scopeType),
        scope.targetFolderId === null ? isNull(importAgentSessions.targetFolderId) : eq(importAgentSessions.targetFolderId, scope.targetFolderId),
        isNull(importAgentSessions.deletedAt)
      )
    )
    .orderBy(desc(importAgentSessions.updatedAt), desc(importAgentSessions.createdAt))
    .all()

  const sessionIds = sessionRows.map(session => session.id)
  const planRows = sessionIds.length
    ? db
        .select()
        .from(importAgentPlans)
        .where(inArray(importAgentPlans.sessionId, sessionIds))
        .orderBy(desc(importAgentPlans.updatedAt), desc(importAgentPlans.createdAt))
        .all()
    : []

  const messagesBySessionId = new Map<string, ImportAgentMessage[]>(
    Object.entries(options?.messagesBySessionId ?? {})
  )

  const plansBySessionId = new Map<string, ImportAgentPlanRow[]>()
  for (const row of planRows) {
    const existing = plansBySessionId.get(row.sessionId) ?? []
    existing.push(row)
    plansBySessionId.set(row.sessionId, existing)
  }

  const sessions: ImportAgentSessionState[] = sessionRows.map(session => {
    const messages = messagesBySessionId.get(session.id) ?? []
    const sessionPlans = plansBySessionId.get(session.id) ?? []
    const activeDraft = sessionPlans.find(plan => plan.kind === 'draft' && plan.status === 'active') ?? null
    const appliedPlans = sessionPlans.filter(plan => plan.kind === 'applied' && plan.status === 'applied').map(toImportAgentPlanRecord)

    return {
      session: {
        id: session.id,
        scopeType: session.scopeType as ImportAgentScopeType,
        targetFolderId: session.targetFolderId,
        title: session.title,
        opencodeSessionId: session.opencodeSessionId,
        selectedModel: session.selectedModel,
        status: session.status as ImportAgentSessionStatus,
        messageCount: messages.length,
        latestErrorMessage: session.latestErrorMessage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        deletedAt: session.deletedAt,
      },
      messages,
      activePlan: activeDraft ? toImportAgentPlanRecord(activeDraft) : null,
      appliedPlans,
    }
  })

  return {
    scopeType: scope.scopeType,
    targetFolderId: scope.targetFolderId,
    sessions,
  }
}

export function getImportAgentSession(sessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(importAgentSessions)
    .where(and(eq(importAgentSessions.id, sessionId), isNull(importAgentSessions.deletedAt)))
    .get() ?? null
}

export function getImportAgentSessionByOpenCodeSessionId(opencodeSessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(importAgentSessions)
    .where(and(eq(importAgentSessions.opencodeSessionId, opencodeSessionId), isNull(importAgentSessions.deletedAt)))
    .get() ?? null
}

export function updateImportAgentSession(sessionId: string, patch: Partial<ImportAgentSessionRow>) {
  const db = getDb()
  db.update(importAgentSessions)
    .set({ ...patch, updatedAt: Date.now() })
    .where(and(eq(importAgentSessions.id, sessionId), isNull(importAgentSessions.deletedAt)))
    .run()
}

export function getCurrentImportAgentDraftPlan(sessionId: string): ImportAgentPlanRecord | null {
  const db = getDb()
  const row = db
    .select()
    .from(importAgentPlans)
    .where(and(eq(importAgentPlans.sessionId, sessionId), eq(importAgentPlans.kind, 'draft'), eq(importAgentPlans.status, 'active')))
    .orderBy(desc(importAgentPlans.updatedAt), desc(importAgentPlans.createdAt))
    .get()

  return row ? toImportAgentPlanRecord(row) : null
}

export function listAppliedImportAgentPlans(sessionId: string): ImportAgentPlanRecord[] {
  const db = getDb()
  return db
    .select()
    .from(importAgentPlans)
    .where(and(eq(importAgentPlans.sessionId, sessionId), eq(importAgentPlans.kind, 'applied'), eq(importAgentPlans.status, 'applied')))
    .orderBy(desc(importAgentPlans.updatedAt), desc(importAgentPlans.createdAt))
    .all()
    .map(toImportAgentPlanRecord)
}

export function setCurrentImportAgentDraftPlan(sessionId: string, plan: ImportAgentPlan) {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(importAgentPlans)
    .where(and(eq(importAgentPlans.sessionId, sessionId), eq(importAgentPlans.kind, 'draft'), eq(importAgentPlans.status, 'active')))
    .get()

  if (existing) {
    db.update(importAgentPlans)
      .set({ planJson: JSON.stringify(plan), updatedAt: now })
      .where(eq(importAgentPlans.id, existing.id))
      .run()
    return toImportAgentPlanRecord({ ...existing, planJson: JSON.stringify(plan), updatedAt: now })
  }

  const row: ImportAgentPlanRow = {
    id: crypto.randomUUID(),
    sessionId,
    kind: 'draft',
    status: 'active',
    planJson: JSON.stringify(plan),
    createdAt: now,
    updatedAt: now,
  }
  db.insert(importAgentPlans).values(row).run()
  return toImportAgentPlanRecord(row)
}

export function clearCurrentImportAgentDraftPlan(sessionId: string) {
  const db = getDb()
  db.update(importAgentPlans)
    .set({ status: 'superseded', updatedAt: Date.now() })
    .where(and(eq(importAgentPlans.sessionId, sessionId), eq(importAgentPlans.kind, 'draft'), eq(importAgentPlans.status, 'active')))
    .run()
}

export async function applyImportAgentDraftPlan(sessionId: string) {
  const db = getDb()
  const session = getImportAgentSession(sessionId)
  if (!session) {
    throw new Error('Import session not found.')
  }

  const activeDraftRow = db
    .select()
    .from(importAgentPlans)
    .where(and(eq(importAgentPlans.sessionId, sessionId), eq(importAgentPlans.kind, 'draft'), eq(importAgentPlans.status, 'active')))
    .get()

  if (!activeDraftRow) {
    throw new Error('No active draft plan exists for this session.')
  }

  const plan = normalizeImportAgentPlan(JSON.parse(activeDraftRow.planJson))
  if (plan.questions.length > 0) {
    throw new Error('Resolve all draft questions before applying changes.')
  }

  const explorerItems = await listExplorerItems()
  const allowedFolderIds = collectAllowedFolderIds(explorerItems, session.scopeType as ImportAgentScopeType, session.targetFolderId)
  const allowedRequestIds = new Set(
    explorerItems
      .filter(item => item.itemType === 'request' && allowedFolderIds.has(item.parentFolderId ?? 'workspace-root'))
      .map(item => item.id)
  )

  db.transaction(tx => {
    const folderIdMap = new Map<string, string>()
    for (const folder of plan.foldersToCreate) {
      const parentFolderId = resolvePlanParentFolderId(folder.parentFolderId, folderIdMap, session)
      if (!allowedFolderIds.has(parentFolderId ?? 'workspace-root')) {
        throw new Error(`Folder "${folder.name}" is outside the import scope.`)
      }

      const createdId = insertFolderFromPlan(tx, parentFolderId, folder.name)
      folderIdMap.set(folder.id, createdId)
      allowedFolderIds.add(createdId)
    }

    for (const request of plan.requestsToCreate) {
      const parentFolderId = resolvePlanParentFolderId(request.parentFolderId, folderIdMap, session)
      if (!allowedFolderIds.has(parentFolderId ?? 'workspace-root')) {
        throw new Error(`Request "${request.name}" is outside the import scope.`)
      }

      insertRequestFromPlan(tx, parentFolderId, request)
    }

    for (const request of plan.requestsToUpdate) {
      if (!allowedRequestIds.has(request.requestId)) {
        throw new Error(`Request "${request.requestId}" is outside the import scope.`)
      }

      updateRequestFromPlan(tx, request)
    }
    for (const environmentUpdate of plan.environmentUpdates) {
      applyEnvironmentUpdate(tx, environmentUpdate.environmentId, environmentUpdate.variables)
    }

    const now = Date.now()
    tx.update(importAgentPlans)
      .set({ kind: 'applied', status: 'applied', updatedAt: now })
      .where(eq(importAgentPlans.id, activeDraftRow.id))
      .run()

    tx.update(importAgentSessions)
      .set({ status: 'idle', latestErrorMessage: null, updatedAt: now })
      .where(eq(importAgentSessions.id, sessionId))
      .run()
  })

  return await loadImportAgentWorkspaceState({ scopeType: session.scopeType as ImportAgentScopeType, targetFolderId: session.targetFolderId })
}

function insertFolderFromPlan(tx: Database, parentFolderId: string | null, name: string) {
  const now = Date.now()
  const folderId = crypto.randomUUID()
  const position = getNextTreePosition(tx, parentFolderId)
  tx.insert(folders)
    .values({
      id: folderId,
      parentId: parentFolderId,
      name,
      description: '',
      headers: '',
      authJson: serializeHttpAuth(createDefaultHttpAuth()),
      preRequestScript: '',
      postRequestScript: '',
      runConfigJson: '{"selectionMode":"tests-only","selectedRequestIds":[],"executionMode":"sequential","continueOnFailure":true}',
      position,
      createdAt: now,
      deletedAt: null,
    })
    .run()
  tx.insert(treeItems)
    .values({
      id: crypto.randomUUID(),
      parentFolderId,
      itemType: 'folder',
      itemId: folderId,
      position,
      createdAt: now,
      deletedAt: null,
    })
    .run()
  return folderId
}

function insertRequestFromPlan(tx: Database, parentFolderId: string | null, request: ImportAgentRequestCreatePlanItem) {
  const now = Date.now()
  const requestId = crypto.randomUUID()
  const position = getNextTreePosition(tx, parentFolderId)
  tx.insert(requests)
    .values({
      id: requestId,
      name: request.name,
      requestType: 'http',
      method: request.method,
      url: request.url,
      pathParams: request.pathParams,
      searchParams: request.searchParams,
      authJson: serializeHttpAuth(request.auth),
      preRequestScript: request.preRequestScript,
      postRequestScript: request.postRequestScript,
      testScript: request.testScript,
      responseVisualizer: request.responseVisualizer,
      responseTableAccessor: request.responseTableAccessor,
      preferredResponseBodyView: request.preferredResponseBodyView,
      prefersResponseVisualizer: request.preferredResponseBodyView === 'visualizer',
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType,
      rawType: request.rawType,
      graphqlQuery: request.graphqlQuery,
      graphqlVariables: request.graphqlVariables,
      graphqlSchema: '',
      websocketSubprotocols: '',
      websocketOnOpenMessage: '',
      websocketAutoSendEnabled: false,
      websocketAutoSendMessage: '',
      websocketAutoSendIntervalSeconds: 0,
      saveToHistory: request.saveToHistory,
      createdAt: now,
      deletedAt: null,
    })
    .run()

  tx.insert(treeItems)
    .values({
      id: crypto.randomUUID(),
      parentFolderId,
      itemType: 'request',
      itemId: requestId,
      position,
      createdAt: now,
      deletedAt: null,
    })
    .run()
}

function updateRequestFromPlan(tx: Database, request: ImportAgentRequestUpdatePlanItem) {
  tx.update(requests)
    .set({
      name: request.name,
      method: request.method,
      url: request.url,
      pathParams: request.pathParams,
      searchParams: request.searchParams,
      authJson: serializeHttpAuth(request.auth),
      preRequestScript: request.preRequestScript,
      postRequestScript: request.postRequestScript,
      testScript: request.testScript,
      responseVisualizer: request.responseVisualizer,
      responseTableAccessor: request.responseTableAccessor,
      preferredResponseBodyView: request.preferredResponseBodyView,
      prefersResponseVisualizer: request.preferredResponseBodyView === 'visualizer',
      headers: request.headers,
      body: request.body,
      bodyType: request.bodyType,
      rawType: request.rawType,
      graphqlQuery: request.graphqlQuery,
      graphqlVariables: request.graphqlVariables,
      saveToHistory: request.saveToHistory,
    })
    .where(and(eq(requests.id, request.requestId), isNull(requests.deletedAt)))
    .run()
}

function applyEnvironmentUpdate(tx: Database, environmentId: string, variables: Array<{ key: string; value: string }>) {
  const row = tx
    .select({ variables: environments.variables })
    .from(environments)
    .where(and(eq(environments.id, environmentId), isNull(environments.deletedAt)))
    .get()

  if (!row) {
    throw new Error(`Environment "${environmentId}" was not found.`)
  }

  const existingRows = parseKeyValueRows(row.variables)
  const existingByKey = new Map(existingRows.map(variable => [variable.key.trim(), variable]))

  for (const variable of variables) {
    const existing = existingByKey.get(variable.key)
    if (existing) {
      existing.value = variable.value
      existing.enabled = true
    } else {
      existingRows.push({
        id: crypto.randomUUID(),
        enabled: true,
        key: variable.key,
        value: variable.value,
        description: '',
      })
    }
  }

  tx.update(environments)
    .set({ variables: stringifyKeyValueRows(existingRows) })
    .where(and(eq(environments.id, environmentId), isNull(environments.deletedAt)))
    .run()
}

function resolvePlanParentFolderId(parentFolderId: string | null, folderIdMap: Map<string, string>, session: ImportAgentSessionRow) {
  if (parentFolderId === null) {
    return session.scopeType === 'folder' ? session.targetFolderId : null
  }

  return folderIdMap.get(parentFolderId) ?? parentFolderId
}

function getNextTreePosition(tx: Database, parentFolderId: string | null) {
  const siblings = tx
    .select({ position: treeItems.position })
    .from(treeItems)
    .where(parentFolderId === null ? and(isNull(treeItems.parentFolderId), isNull(treeItems.deletedAt)) : and(eq(treeItems.parentFolderId, parentFolderId), isNull(treeItems.deletedAt)))
    .all()

  return siblings.length === 0 ? 0 : Math.max(...siblings.map(item => item.position)) + 1
}

function collectAllowedFolderIds(
  explorerItems: Awaited<ReturnType<typeof listExplorerItems>>,
  scopeType: ImportAgentScopeType,
  targetFolderId: string | null
) {
  const allowedFolderIds = new Set<string>()
  if (scopeType === 'workspace') {
    allowedFolderIds.add('workspace-root')
    for (const item of explorerItems) {
      if (item.itemType === 'folder') {
        allowedFolderIds.add(item.id)
      }
    }
    return allowedFolderIds
  }

  if (!targetFolderId) {
    throw new Error('Folder import scope is missing its target folder.')
  }

  allowedFolderIds.add(targetFolderId)
  const pending = [targetFolderId]
  while (pending.length > 0) {
    const currentFolderId = pending.pop() ?? null
    for (const item of explorerItems) {
      if (item.itemType === 'folder' && item.parentFolderId === currentFolderId) {
        allowedFolderIds.add(item.id)
        pending.push(item.id)
      }
    }
  }
  return allowedFolderIds
}

function toImportAgentPlanRecord(row: ImportAgentPlanRow): ImportAgentPlanRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind as ImportAgentPlanRecord['kind'],
    status: row.status as ImportAgentPlanRecord['status'],
    plan: normalizeImportAgentPlan(JSON.parse(row.planJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function parseJson<T>(value: string, fallback: T) {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
