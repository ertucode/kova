import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { createDefaultHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import {
  type ImportAgentParentScope,
  normalizeImportAgentPlan,
  type ImportAgentMessage,
  type ImportAgentItemTagUpdatePlanItem,
  type ImportAgentPlan,
  type ImportAgentPlanRecord,
  type ImportAgentRequestCreatePlanItem,
  type ImportAgentRequestUpdatePlanItem,
  type ImportAgentScope,
  type ImportAgentScopeType,
  type ImportAgentSessionState,
  type ImportAgentSessionStatus,
  type ImportAgentTagCreatePlanItem,
  type ImportAgentTagItemUpdatePlanItem,
  type ImportAgentTagUpdatePlanItem,
  type ImportAgentWorkspaceState,
} from '../../common/ImportAgent.js'
import { normalizeTagColor, type TaggableItemType } from '../../common/Tags.js'
import { getDb } from './index.js'
import { environments, folders, importAgentPlans, importAgentSessions, requests, tagAssignments, tags, treeItems } from './schema.js'
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

  db.transaction(tx => {
    const folderIdMap = new Map<string, string>()
    const tagIdMap = new Map<string, string>()
    for (const folder of plan.foldersToCreate) {
      const parentFolderId = resolvePlanParentFolderId(folder.parentFolderId, folder.parentScope, folderIdMap, session)

      const createdId = insertFolderFromPlan(tx, parentFolderId, folder.name)
      folderIdMap.set(folder.id, createdId)
    }

    for (const request of plan.requestsToCreate) {
      const parentFolderId = resolvePlanParentFolderId(request.parentFolderId, request.parentScope, folderIdMap, session)

      insertRequestFromPlan(tx, parentFolderId, request)
    }

    for (const request of plan.requestsToUpdate) {
      updateRequestFromPlan(tx, request)
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

function insertTagFromPlan(tx: Database, tag: ImportAgentTagCreatePlanItem) {
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

function updateTagFromPlan(tx: Database, tag: ImportAgentTagUpdatePlanItem, tagIdMap: Map<string, string>) {
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

function applyItemTagUpdate(tx: Database, itemTagUpdate: ImportAgentItemTagUpdatePlanItem, tagIdMap: Map<string, string>) {
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

function applyTagItemUpdate(tx: Database, tagItemUpdate: ImportAgentTagItemUpdatePlanItem, tagIdMap: Map<string, string>) {
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
  parentScope: ImportAgentParentScope | undefined,
  folderIdMap: Map<string, string>,
  session: ImportAgentSessionRow
) {
  if (parentFolderId === null) {
    return resolvePlanRootFolderId(session, parentScope)
  }

  return folderIdMap.get(parentFolderId) ?? parentFolderId
}

function resolvePlanRootFolderId(session: ImportAgentSessionRow, parentScope: ImportAgentParentScope | undefined) {
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

function ensureNoTagAssignmentConflicts(
  itemTagUpdates: ImportAgentItemTagUpdatePlanItem[],
  tagItemUpdates: ImportAgentTagItemUpdatePlanItem[]
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
