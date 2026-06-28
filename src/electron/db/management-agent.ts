import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDefaultHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import {
  type ManagementAgentFolderUpdatePlanItem,
  type ManagementAgentParentScope,
  normalizeManagementAgentPlan,
  type ManagementAgentMessage,
  type ManagementAgentItemTagUpdatePlanItem,
  type ManagementAgentPlan,
  type ManagementAgentPlanRecord,
  type ManagementAgentRequestCreatePlanItem,
  type ManagementAgentRequestUpdatePlanItem,
  type ManagementAgentScope,
  type ManagementAgentScopeType,
  type ManagementAgentSessionState,
  type ManagementAgentSessionStatus,
  type ManagementAgentTagCreatePlanItem,
  type ManagementAgentTagItemUpdatePlanItem,
  type ManagementAgentTagUpdatePlanItem,
  type ManagementAgentWorkspaceState,
} from '../../common/ManagementAgent.js'
import { normalizeTagColor, type TaggableItemType } from '../../common/Tags.js'
import { getDb } from './index.js'
import {
  environments,
  folders,
  managementAgentPlans,
  managementAgentSessions,
  requestExamples,
  requests,
  tagAssignments,
  tags,
  treeItems,
  websocketExamples,
} from './schema.js'
import { parseKeyValueRows, stringifyKeyValueRows } from '../../common/KeyValueRows.js'

type Database = BetterSQLite3Database<any>
type ManagementAgentSessionRow = typeof managementAgentSessions.$inferSelect
type ManagementAgentPlanRow = typeof managementAgentPlans.$inferSelect

export async function createManagementAgentSessionRecord(input: ManagementAgentScope & { title: string; selectedModel: string | null }) {
  const db = getDb()
  const now = Date.now()
  const session: ManagementAgentSessionRow = {
    id: crypto.randomUUID(),
    scopeType: input.scopeType,
    targetFolderId: input.targetFolderId,
    targetRequestId: input.targetRequestId,
    title: input.title,
    opencodeSessionId: null,
    selectedModel: input.selectedModel,
    status: 'idle',
    latestErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  db.insert(managementAgentSessions).values(session).run()
  return await loadManagementAgentWorkspaceState({
    scopeType: input.scopeType,
    targetFolderId: input.targetFolderId,
    targetRequestId: input.targetRequestId,
  })
}

export async function loadManagementAgentWorkspaceState(
  scope: ManagementAgentScope,
  options?: {
    messagesBySessionId?: Record<string, ManagementAgentMessage[]>
  }
): Promise<ManagementAgentWorkspaceState> {
  const db = getDb()
  const scopeMatcher = scope.scopeType === 'request'
    ? and(
        eq(managementAgentSessions.scopeType, scope.scopeType),
        scope.targetRequestId === null ? isNull(managementAgentSessions.targetRequestId) : eq(managementAgentSessions.targetRequestId, scope.targetRequestId),
        isNull(managementAgentSessions.deletedAt)
      )
    : and(
        eq(managementAgentSessions.scopeType, scope.scopeType),
        scope.targetFolderId === null ? isNull(managementAgentSessions.targetFolderId) : eq(managementAgentSessions.targetFolderId, scope.targetFolderId),
        scope.targetRequestId === null ? isNull(managementAgentSessions.targetRequestId) : eq(managementAgentSessions.targetRequestId, scope.targetRequestId),
        isNull(managementAgentSessions.deletedAt)
      )
  const sessionRows = db
    .select()
    .from(managementAgentSessions)
    .where(scopeMatcher)
    .orderBy(desc(managementAgentSessions.updatedAt), desc(managementAgentSessions.createdAt))
    .all()

  const sessionIds = sessionRows.map(session => session.id)
  const planRows = sessionIds.length
    ? db
        .select()
        .from(managementAgentPlans)
        .where(inArray(managementAgentPlans.sessionId, sessionIds))
        .orderBy(desc(managementAgentPlans.updatedAt), desc(managementAgentPlans.createdAt))
        .all()
    : []

  const messagesBySessionId = new Map<string, ManagementAgentMessage[]>(
    Object.entries(options?.messagesBySessionId ?? {})
  )

  const plansBySessionId = new Map<string, ManagementAgentPlanRow[]>()
  for (const row of planRows) {
    const existing = plansBySessionId.get(row.sessionId) ?? []
    existing.push(row)
    plansBySessionId.set(row.sessionId, existing)
  }

  const sessions: ManagementAgentSessionState[] = sessionRows.map(session => {
    const messages = messagesBySessionId.get(session.id) ?? []
    const sessionPlans = plansBySessionId.get(session.id) ?? []
    const activeDraft = sessionPlans.find(plan => plan.kind === 'draft' && plan.status === 'active') ?? null
    const appliedPlans = sessionPlans.filter(plan => plan.kind === 'applied' && plan.status === 'applied').map(toManagementAgentPlanRecord)

    return {
      session: {
        id: session.id,
        scopeType: session.scopeType as ManagementAgentScopeType,
        targetFolderId: session.targetFolderId,
        targetRequestId: session.targetRequestId,
        title: session.title,
        opencodeSessionId: session.opencodeSessionId,
        selectedModel: session.selectedModel,
        status: session.status as ManagementAgentSessionStatus,
        messageCount: messages.length,
        latestErrorMessage: session.latestErrorMessage,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        deletedAt: session.deletedAt,
      },
      messages,
      activePlan: activeDraft ? toManagementAgentPlanRecord(activeDraft) : null,
      appliedPlans,
    }
  })

  return {
    scopeType: scope.scopeType,
    targetFolderId: scope.targetFolderId,
    targetRequestId: scope.targetRequestId,
    sessions,
  }
}

export function getManagementAgentSession(sessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(managementAgentSessions)
    .where(and(eq(managementAgentSessions.id, sessionId), isNull(managementAgentSessions.deletedAt)))
    .get() ?? null
}

export function getManagementAgentSessionByOpenCodeSessionId(opencodeSessionId: string) {
  const db = getDb()
  return db
    .select()
    .from(managementAgentSessions)
    .where(and(eq(managementAgentSessions.opencodeSessionId, opencodeSessionId), isNull(managementAgentSessions.deletedAt)))
    .get() ?? null
}

export function updateManagementAgentSession(sessionId: string, patch: Partial<ManagementAgentSessionRow>) {
  const db = getDb()
  db.update(managementAgentSessions)
    .set({ ...patch, updatedAt: Date.now() })
    .where(and(eq(managementAgentSessions.id, sessionId), isNull(managementAgentSessions.deletedAt)))
    .run()
}

export function getCurrentManagementAgentDraftPlan(sessionId: string): ManagementAgentPlanRecord | null {
  const db = getDb()
  const row = db
    .select()
    .from(managementAgentPlans)
    .where(and(eq(managementAgentPlans.sessionId, sessionId), eq(managementAgentPlans.kind, 'draft'), eq(managementAgentPlans.status, 'active')))
    .orderBy(desc(managementAgentPlans.updatedAt), desc(managementAgentPlans.createdAt))
    .get()

  return row ? toManagementAgentPlanRecord(row) : null
}

export function listAppliedManagementAgentPlans(sessionId: string): ManagementAgentPlanRecord[] {
  const db = getDb()
  return db
    .select()
    .from(managementAgentPlans)
    .where(and(eq(managementAgentPlans.sessionId, sessionId), eq(managementAgentPlans.kind, 'applied'), eq(managementAgentPlans.status, 'applied')))
    .orderBy(desc(managementAgentPlans.updatedAt), desc(managementAgentPlans.createdAt))
    .all()
    .map(toManagementAgentPlanRecord)
}

export function setCurrentManagementAgentDraftPlan(sessionId: string, plan: ManagementAgentPlan) {
  const db = getDb()
  const now = Date.now()
  const existing = db
    .select()
    .from(managementAgentPlans)
    .where(and(eq(managementAgentPlans.sessionId, sessionId), eq(managementAgentPlans.kind, 'draft'), eq(managementAgentPlans.status, 'active')))
    .get()

  if (existing) {
    db.update(managementAgentPlans)
      .set({ planJson: JSON.stringify(plan), updatedAt: now })
      .where(eq(managementAgentPlans.id, existing.id))
      .run()
    return toManagementAgentPlanRecord({ ...existing, planJson: JSON.stringify(plan), updatedAt: now })
  }

  const row: ManagementAgentPlanRow = {
    id: crypto.randomUUID(),
    sessionId,
    kind: 'draft',
    status: 'active',
    planJson: JSON.stringify(plan),
    createdAt: now,
    updatedAt: now,
  }
  db.insert(managementAgentPlans).values(row).run()
  return toManagementAgentPlanRecord(row)
}

export function clearCurrentManagementAgentDraftPlan(sessionId: string) {
  const db = getDb()
  db.update(managementAgentPlans)
    .set({ status: 'superseded', updatedAt: Date.now() })
    .where(and(eq(managementAgentPlans.sessionId, sessionId), eq(managementAgentPlans.kind, 'draft'), eq(managementAgentPlans.status, 'active')))
    .run()
}

export async function applyManagementAgentDraftPlan(sessionId: string) {
  const db = getDb()
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    throw new Error('Management session not found.')
  }

  const activeDraftRow = db
    .select()
    .from(managementAgentPlans)
    .where(and(eq(managementAgentPlans.sessionId, sessionId), eq(managementAgentPlans.kind, 'draft'), eq(managementAgentPlans.status, 'active')))
    .get()

  if (!activeDraftRow) {
    throw new Error('No active draft plan exists for this session.')
  }

  const plan = normalizeManagementAgentPlan(JSON.parse(activeDraftRow.planJson))
  if (plan.questions.length > 0) {
    throw new Error('Resolve all draft questions before applying changes.')
  }

  db.transaction(tx => {
    const folderIdMap = new Map<string, string>()
    const tagIdMap = new Map<string, string>()
    for (const folder of plan.foldersToCreate) {
      const parentFolderId = resolvePlanParentFolderId(folder.parentFolderId, folder.parentScope, folderIdMap, session)

      const createdId = insertFolderFromPlan(tx, parentFolderId, folder.name)
      folderIdMap.set(folder.id, createdId)
    }

    for (const folder of plan.foldersToUpdate) {
      updateFolderFromPlan(tx, folder)
    }

    for (const request of plan.requestsToCreate) {
      const parentFolderId = resolvePlanParentFolderId(request.parentFolderId, request.parentScope, folderIdMap, session)

      insertRequestFromPlan(tx, parentFolderId, request)
    }

    for (const request of plan.requestsToUpdate) {
      updateRequestFromPlan(tx, request)
    }

    for (const request of plan.requestsToDelete) {
      deleteRequestFromPlan(tx, request.requestId)
    }

    for (const environmentUpdate of plan.environmentUpdates) {
      applyEnvironmentUpdate(tx, environmentUpdate.environmentId, environmentUpdate.variables)
    }

    for (const tag of plan.tagsToCreate) {
      const createdId = insertTagFromPlan(tx, tag)
      tagIdMap.set(tag.id, createdId)
    }

    for (const tag of plan.tagsToUpdate) {
      updateTagFromPlan(tx, tag, tagIdMap)
    }

    ensureNoTagAssignmentConflicts(plan.itemTagUpdates, plan.tagItemUpdates)

    for (const itemTagUpdate of plan.itemTagUpdates) {
      applyItemTagUpdate(tx, itemTagUpdate, tagIdMap)
    }

    for (const tagItemUpdate of plan.tagItemUpdates) {
      applyTagItemUpdate(tx, tagItemUpdate, tagIdMap)
    }

    for (const folder of plan.foldersToDelete) {
      deleteFolderFromPlan(tx, folder.folderId)
    }

    const now = Date.now()
    tx.update(managementAgentPlans)
      .set({ kind: 'applied', status: 'applied', updatedAt: now })
      .where(eq(managementAgentPlans.id, activeDraftRow.id))
      .run()

    tx.update(managementAgentSessions)
      .set({ status: 'idle', latestErrorMessage: null, updatedAt: now })
      .where(eq(managementAgentSessions.id, sessionId))
      .run()
  })

  return await loadManagementAgentWorkspaceState({
    scopeType: session.scopeType as ManagementAgentScopeType,
    targetFolderId: session.targetFolderId,
    targetRequestId: session.targetRequestId,
  })
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

function updateFolderFromPlan(tx: Database, folder: ManagementAgentFolderUpdatePlanItem) {
  tx.update(folders)
    .set({
      name: folder.name,
      description: folder.description,
      headers: folder.headers,
      authJson: serializeHttpAuth(folder.auth),
      preRequestScript: folder.preRequestScript,
      postRequestScript: folder.postRequestScript,
      runConfigJson: JSON.stringify(folder.runConfig),
    })
    .where(and(eq(folders.id, folder.folderId), isNull(folders.deletedAt)))
    .run()
}

function insertRequestFromPlan(tx: Database, parentFolderId: string | null, request: ManagementAgentRequestCreatePlanItem) {
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

function updateRequestFromPlan(tx: Database, request: ManagementAgentRequestUpdatePlanItem) {
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

function deleteRequestFromPlan(tx: Database, requestId: string) {
  const request = tx
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.id, requestId), isNull(requests.deletedAt)))
    .get()

  if (!request) {
    throw new Error('Request not found')
  }

  const now = Date.now()
  tx.update(requests)
    .set({ deletedAt: now })
    .where(and(eq(requests.id, requestId), isNull(requests.deletedAt)))
    .run()

  tx.update(treeItems)
    .set({ deletedAt: now })
    .where(and(eq(treeItems.itemType, 'request'), eq(treeItems.itemId, requestId), isNull(treeItems.deletedAt)))
    .run()

  tx.update(requestExamples)
    .set({ deletedAt: now })
    .where(and(eq(requestExamples.requestId, requestId), isNull(requestExamples.deletedAt)))
    .run()

  tx.update(websocketExamples)
    .set({ deletedAt: now })
    .where(and(eq(websocketExamples.requestId, requestId), isNull(websocketExamples.deletedAt)))
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

function insertTagFromPlan(tx: Database, tag: ManagementAgentTagCreatePlanItem) {
  const name = tag.name.trim()
  if (!name) {
    throw new Error('Tag name is required')
  }

  const existing = getActiveTagByName(tx, name)
  if (existing) {
    throw new Error(`Tag name ${name} is already used`)
  }

  const now = Date.now()
  const tagId = crypto.randomUUID()
  tx.insert(tags)
    .values({
      id: tagId,
      name,
      color: normalizeTagColor(tag.color),
      position: getNextTagPosition(tx),
      createdAt: now,
      deletedAt: null,
    })
    .run()
  return tagId
}

function updateTagFromPlan(tx: Database, tag: ManagementAgentTagUpdatePlanItem, tagIdMap: Map<string, string>) {
  const resolvedTagId = resolvePlanTagId(tag.tagId, tagIdMap)
  const name = tag.name.trim()
  if (!name) {
    throw new Error('Tag name is required')
  }

  const existing = tx.select().from(tags).where(and(eq(tags.id, resolvedTagId), isNull(tags.deletedAt))).get()
  if (!existing) {
    throw new Error('Tag not found')
  }

  const duplicate = getActiveTagByName(tx, name, resolvedTagId)
  if (duplicate) {
    throw new Error(`Tag name ${name} is already used`)
  }

  tx.update(tags)
    .set({ name, color: normalizeTagColor(tag.color) })
    .where(and(eq(tags.id, resolvedTagId), isNull(tags.deletedAt)))
    .run()
}

function applyItemTagUpdate(tx: Database, itemTagUpdate: ManagementAgentItemTagUpdatePlanItem, tagIdMap: Map<string, string>) {
  ensureItemExists(tx, itemTagUpdate.itemType, itemTagUpdate.itemId)
  const resolvedTagIds = getValidatedPlanTagIds(tx, itemTagUpdate.tagIds, tagIdMap)

  tx.delete(tagAssignments)
    .where(and(eq(tagAssignments.itemType, itemTagUpdate.itemType), eq(tagAssignments.itemId, itemTagUpdate.itemId)))
    .run()

  resolvedTagIds.forEach(tagId => {
    tx.insert(tagAssignments)
      .values({
        id: crypto.randomUUID(),
        tagId,
        itemType: itemTagUpdate.itemType,
        itemId: itemTagUpdate.itemId,
        createdAt: Date.now(),
      })
      .run()
  })
}

function applyTagItemUpdate(tx: Database, tagItemUpdate: ManagementAgentTagItemUpdatePlanItem, tagIdMap: Map<string, string>) {
  const resolvedTagId = resolvePlanTagId(tagItemUpdate.tagId, tagIdMap)
  const tag = tx.select({ id: tags.id }).from(tags).where(and(eq(tags.id, resolvedTagId), isNull(tags.deletedAt))).get()
  if (!tag) {
    throw new Error('Tag not found')
  }

  const dedupedItems = Array.from(new Map(
    tagItemUpdate.items.map(item => [`${item.itemType}:${item.itemId}`, item])
  ).values())

  dedupedItems.forEach(item => ensureItemExists(tx, item.itemType, item.itemId))

  tx.delete(tagAssignments).where(eq(tagAssignments.tagId, resolvedTagId)).run()

  dedupedItems.forEach(item => {
    tx.insert(tagAssignments)
      .values({
        id: crypto.randomUUID(),
        tagId: resolvedTagId,
        itemType: item.itemType,
        itemId: item.itemId,
        createdAt: Date.now(),
      })
      .run()
  })
}

function resolvePlanParentFolderId(
  parentFolderId: string | null,
  parentScope: ManagementAgentParentScope | undefined,
  folderIdMap: Map<string, string>,
  session: ManagementAgentSessionRow
) {
  if (parentFolderId === null) {
    return resolvePlanRootFolderId(session, parentScope)
  }

  return folderIdMap.get(parentFolderId) ?? parentFolderId
}

function resolvePlanRootFolderId(session: ManagementAgentSessionRow, parentScope: ManagementAgentParentScope | undefined) {
  const resolvedParentScope = parentScope ?? (session.scopeType === 'folder' ? 'session-root' : 'workspace-root')
  if (resolvedParentScope === 'workspace-root') {
    return null
  }

  return session.scopeType === 'folder' ? session.targetFolderId : null
}

function getNextTreePosition(tx: Database, parentFolderId: string | null) {
  const siblings = tx
    .select({ position: treeItems.position })
    .from(treeItems)
    .where(parentFolderId === null ? and(isNull(treeItems.parentFolderId), isNull(treeItems.deletedAt)) : and(eq(treeItems.parentFolderId, parentFolderId), isNull(treeItems.deletedAt)))
    .all()

  return siblings.length === 0 ? 0 : Math.max(...siblings.map(item => item.position)) + 1
}

function getNextTagPosition(tx: Database) {
  const rows = tx.select({ position: tags.position }).from(tags).where(isNull(tags.deletedAt)).all()
  if (rows.length === 0) {
    return 0
  }

  return Math.max(...rows.map(row => row.position)) + 1
}

function getActiveTagByName(tx: Database, name: string, excludeId?: string) {
  const rows = tx.select().from(tags).where(isNull(tags.deletedAt)).all()
  return rows.find(row => row.name === name && row.id !== excludeId) ?? null
}

function resolvePlanTagId(tagId: string, tagIdMap: Map<string, string>) {
  return tagIdMap.get(tagId) ?? tagId
}

function getValidatedPlanTagIds(tx: Database, tagIds: string[], tagIdMap: Map<string, string>) {
  const dedupedTagIds = Array.from(new Set(tagIds.map(tagId => resolvePlanTagId(tagId, tagIdMap))))
  if (dedupedTagIds.length === 0) {
    return dedupedTagIds
  }

  const activeTags = tx
    .select({ id: tags.id })
    .from(tags)
    .where(and(inArray(tags.id, dedupedTagIds), isNull(tags.deletedAt)))
    .all()
    .map(row => row.id)

  if (activeTags.length !== dedupedTagIds.length) {
    throw new Error('One or more tags were not found')
  }

  return dedupedTagIds
}

function ensureItemExists(tx: Database, itemType: TaggableItemType, itemId: string) {
  const exists =
    itemType === 'folder'
      ? tx.select({ id: folders.id }).from(folders).where(and(eq(folders.id, itemId), isNull(folders.deletedAt))).get()
      : tx.select({ id: requests.id }).from(requests).where(and(eq(requests.id, itemId), isNull(requests.deletedAt))).get()

  if (!exists) {
    throw new Error(itemType === 'folder' ? 'Folder not found' : 'Request not found')
  }
}

function deleteFolderFromPlan(tx: Database, rootFolderId: string) {
  const rootFolder = tx
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, rootFolderId), isNull(folders.deletedAt)))
    .get()

  if (!rootFolder) {
    throw new Error('Folder not found')
  }

  const folderRows = tx
    .select({ id: folders.id, parentId: folders.parentId })
    .from(folders)
    .where(isNull(folders.deletedAt))
    .all()

  const subtreeFolderIds = new Set<string>([rootFolderId])
  let changed = true
  while (changed) {
    changed = false
    folderRows.forEach(folder => {
      if (folder.parentId && subtreeFolderIds.has(folder.parentId) && !subtreeFolderIds.has(folder.id)) {
        subtreeFolderIds.add(folder.id)
        changed = true
      }
    })
  }

  const folderIds = Array.from(subtreeFolderIds)
  const requestIds = tx
    .select({ itemId: treeItems.itemId })
    .from(treeItems)
    .where(and(eq(treeItems.itemType, 'request'), inArray(treeItems.parentFolderId, folderIds), isNull(treeItems.deletedAt)))
    .all()
    .map(row => row.itemId)

  const now = Date.now()
  tx.update(folders)
    .set({ deletedAt: now })
    .where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)))
    .run()

  tx.update(treeItems)
    .set({ deletedAt: now })
    .where(
      and(
        isNull(treeItems.deletedAt),
        inArray(treeItems.itemType, ['folder', 'request']),
        inArray(treeItems.itemId, [...folderIds, ...requestIds])
      )
    )
    .run()

  if (requestIds.length === 0) {
    return
  }

  tx.update(requests)
    .set({ deletedAt: now })
    .where(and(inArray(requests.id, requestIds), isNull(requests.deletedAt)))
    .run()

  tx.update(requestExamples)
    .set({ deletedAt: now })
    .where(and(inArray(requestExamples.requestId, requestIds), isNull(requestExamples.deletedAt)))
    .run()

  tx.update(websocketExamples)
    .set({ deletedAt: now })
    .where(and(inArray(websocketExamples.requestId, requestIds), isNull(websocketExamples.deletedAt)))
    .run()
}

function ensureNoTagAssignmentConflicts(
  itemTagUpdates: ManagementAgentItemTagUpdatePlanItem[],
  tagItemUpdates: ManagementAgentTagItemUpdatePlanItem[]
) {
  const directlyUpdatedItemKeys = new Set(itemTagUpdates.map(itemTagUpdate => `${itemTagUpdate.itemType}:${itemTagUpdate.itemId}`))
  for (const tagItemUpdate of tagItemUpdates) {
    for (const item of tagItemUpdate.items) {
      const itemKey = `${item.itemType}:${item.itemId}`
      if (directlyUpdatedItemKeys.has(itemKey)) {
        throw new Error(`Conflicting tag assignment updates for ${itemKey}`)
      }
    }
  }
}

function toManagementAgentPlanRecord(row: ManagementAgentPlanRow): ManagementAgentPlanRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    kind: row.kind as ManagementAgentPlanRecord['kind'],
    status: row.status as ManagementAgentPlanRecord['status'],
    plan: normalizeManagementAgentPlan(JSON.parse(row.planJson)),
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
