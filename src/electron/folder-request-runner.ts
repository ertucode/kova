import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  createEmptyFolderRunSummary,
  type FolderRunRecord,
  type FolderRunRequest,
  type FolderRunRequestStatus,
  type FolderRunSummary,
  type RunFolderRequestsInput,
  type RunFolderRequestsResponse,
} from '../common/FolderRuns.js'
import type { ExplorerItem } from '../common/Explorer.js'
import type { HttpRequestRecord, RequestExecutionRecord, SendRequestInput } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { getFolder } from './db/folders.js'
import { listVisibleEnvironments } from './db/environments.js'
import { listExplorerItems } from './db/explorer.js'
import { getRequest } from './db/requests.js'
import { listVisibleSharedScripts } from './db/shared-scripts.js'
import { createFolderRunHistory, updateFolderRunHistory } from './db/folder-run-history.js'
import { cancelHttpRequest, sendRequest } from './send-request.js'
import { emitGenericEvent } from './generic-events.js'

type SendRequestOptions = Parameters<typeof sendRequest>[1]

type ActiveRunState = {
  run: FolderRunRecord
  activeRequestIds: Set<string>
  isCancelling: boolean
}

type ResolvedFolderRequest = {
  item: Extract<ExplorerItem, { itemType: 'request' }>
  request: HttpRequestRecord
  hasTests: boolean
  position: number
}

type OverlappingFolderRun = RunFolderRequestsResponse['overlappingRuns'][number]

const activeRunsById = new Map<string, ActiveRunState>()
const activeRunIdByFolderId = new Map<string, string>()

export async function runFolderRequests(
  input: RunFolderRequestsInput,
  options?: SendRequestOptions
): Promise<GenericResult<RunFolderRequestsResponse>> {
  if (activeRunIdByFolderId.has(input.folderId)) {
    return GenericError.Message('This folder already has an active run')
  }

  const folderResult = await getFolder({ id: input.folderId })
  if (!folderResult.success) {
    return folderResult
  }

  const items = await listExplorerItems()
  const overlap = getOverlappingRuns(items, input.folderId)
  const resolvedRequests = await resolveFolderRequests(items, input)
  const now = Date.now()
  const run: FolderRunRecord = {
    id: crypto.randomUUID(),
    folderId: input.folderId,
    folderName: folderResult.data.name,
    config: input.config,
    status: 'running',
    summary: createEmptyFolderRunSummary(resolvedRequests.length),
    requests: resolvedRequests.map(toFolderRunRequest),
    overlappingFolderRunIds: overlap.map(item => item.runId),
    startedAt: now,
    completedAt: null,
  }
  const state: ActiveRunState = { run, activeRequestIds: new Set(), isCancelling: false }

  activeRunsById.set(run.id, state)
  activeRunIdByFolderId.set(run.folderId, run.id)
  createFolderRunHistory(run)
  emitGenericEvent({ type: 'folder-run-started', run: cloneRun(run) })

  void executeRun(state, resolvedRequests, input, options).catch(error => {
    console.error('folder run failed', error)
    finishRun(state, 'failed')
  })

  return Result.Success({ run: cloneRun(run), overlappingRuns: overlap })
}

export async function cancelFolderRun(input: { runId: string }): Promise<GenericResult<void>> {
  const state = activeRunsById.get(input.runId)
  if (!state) {
    return GenericError.Message('Folder run is not active')
  }

  state.isCancelling = true
  await Promise.all(Array.from(state.activeRequestIds).map(requestId => cancelHttpRequest({ requestId })))
  return Result.Success(undefined)
}

export function listActiveFolderRuns() {
  return Array.from(activeRunsById.values()).map(state => cloneRun(state.run))
}

async function executeRun(
  state: ActiveRunState,
  requests: ResolvedFolderRequest[],
  input: RunFolderRequestsInput,
  options: SendRequestOptions | undefined
) {
  if (requests.length === 0) {
    finishRun(state, 'completed')
    return
  }

  if (input.config.executionMode === 'parallel') {
    await Promise.all(
      requests.map(async request => {
        const environmentSnapshot = await listVisibleEnvironments({
          folderId: request.item.parentFolderId,
          activeEnvironmentIds: input.activeEnvironmentIds,
        })
        await executeRequest(state, request, input, options, environmentSnapshot)
      })
    )
  } else {
    for (const request of requests) {
      if (state.isCancelling) {
        markRemainingRequests(state, 'cancelled')
        break
      }

      await executeRequest(state, request, input, options)
      if (!input.config.continueOnFailure && state.run.requests.some(item => item.status === 'failed')) {
        markRemainingRequests(state, 'skipped')
        break
      }
    }
  }

  finishRun(state, state.isCancelling ? 'cancelled' : 'completed')
}

async function executeRequest(
  state: ActiveRunState,
  resolved: ResolvedFolderRequest,
  input: RunFolderRequestsInput,
  options: SendRequestOptions | undefined,
  environmentSnapshot?: SendRequestInput['environmentSnapshot']
) {
  if (state.isCancelling) {
    updateRequestState(state, resolved.request.id, { status: 'cancelled', completedAt: Date.now() })
    return
  }

  const startedAt = Date.now()
  state.activeRequestIds.add(resolved.request.id)
  updateRequestState(state, resolved.request.id, { status: 'running', startedAt })
  emitGenericEvent({
    type: 'folder-run-request-started',
    runId: state.run.id,
    folderId: state.run.folderId,
    requestId: resolved.request.id,
    startedAt,
    summary: state.run.summary,
  })

  try {
    const result = await sendRequest(toSendRequestInput(resolved.request, input, state.run.id, environmentSnapshot), options)
    if (!result.success) {
      updateRequestState(state, resolved.request.id, {
        status: state.isCancelling ? 'cancelled' : 'failed',
        error: result.error.type === 'message' ? result.error.message : 'Request failed',
        completedAt: Date.now(),
      })
      return
    }

    const execution = result.data.execution
    updateRequestState(state, resolved.request.id, {
      status: getRequestStatus(execution),
      execution,
      error: execution.responseError,
      completedAt: execution.response?.receivedAt ?? Date.now(),
    })
  } catch (error) {
    updateRequestState(state, resolved.request.id, {
      status: state.isCancelling ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    })
  } finally {
    state.activeRequestIds.delete(resolved.request.id)
    const request = state.run.requests.find(item => item.requestId === resolved.request.id)
    if (request) {
      emitGenericEvent({
        type: 'folder-run-request-completed',
        runId: state.run.id,
        folderId: state.run.folderId,
        request: { ...request },
        summary: state.run.summary,
      })
    }
  }
}

async function resolveFolderRequests(items: ExplorerItem[], input: RunFolderRequestsInput): Promise<ResolvedFolderRequest[]> {
  const descendantFolderIds = getDescendantFolderIds(items, input.folderId)
  const requestItems = items
    .filter(
      (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
        item.itemType === 'request' && item.requestType === 'http' && item.parentFolderId !== null && descendantFolderIds.has(item.parentFolderId)
    )
    .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)

  const resolved = await Promise.all(
    requestItems.map(async (item, position) => {
      const requestResult = await getRequest({ id: item.id })
      if (!requestResult.success || requestResult.data.requestType !== 'http') {
        return null
      }

      return {
        item,
        request: requestResult.data,
        hasTests: await hasRunnableTests(item.parentFolderId, requestResult.data),
        position,
      } satisfies ResolvedFolderRequest
    })
  )

  const valid = resolved.filter((item): item is ResolvedFolderRequest => item !== null)
  switch (input.config.selectionMode) {
    case 'all':
      return valid
    case 'tests-only':
      return valid.filter(item => item.hasTests)
    case 'custom': {
      const selectedIds = new Set(input.config.selectedRequestIds)
      return valid.filter(item => selectedIds.has(item.request.id))
    }
  }
}

async function hasRunnableTests(parentFolderId: string | null, request: HttpRequestRecord) {
  if (request.testScript.trim()) {
    return true
  }

  const sharedScripts = await listVisibleSharedScripts({ folderId: parentFolderId, target: 'test', onlyActive: true })
  return sharedScripts.some(script => script.code.trim())
}

function toFolderRunRequest(resolved: ResolvedFolderRequest): FolderRunRequest {
  return {
    requestId: resolved.request.id,
    requestName: resolved.request.name,
    method: resolved.request.method,
    url: resolved.request.url,
    position: resolved.position,
    hasTests: resolved.hasTests,
    status: 'pending',
    execution: null,
    error: null,
    startedAt: null,
    completedAt: null,
  }
}

function toSendRequestInput(
  request: HttpRequestRecord,
  input: RunFolderRequestsInput,
  runId: string,
  environmentSnapshot: SendRequestInput['environmentSnapshot']
): SendRequestInput {
  return {
    requestId: request.id,
    method: request.method,
    url: request.url,
    pathParams: request.pathParams,
    searchParams: request.searchParams,
    auth: request.auth,
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    testScript: request.testScript,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType,
    rawType: request.rawType,
    graphqlQuery: request.graphqlQuery,
    graphqlVariables: request.graphqlVariables,
    tlsVerificationMode: request.tlsVerificationMode,
    activeEnvironmentIds: input.activeEnvironmentIds,
    environmentSnapshot,
    saveToHistory: request.saveToHistory,
    historyKeepLast: input.historyKeepLast,
    folderRunId: runId,
    folderRunFolderId: input.folderId,
    requestMetadata: {
      sourceRuntime: 'folder-run',
      isRetry: false,
      retryCount: 0,
    },
  }
}

function updateRequestState(
  state: ActiveRunState,
  requestId: string,
  patch: Partial<Omit<FolderRunRequest, 'requestId'>>
) {
  state.run.requests = state.run.requests.map(request =>
    request.requestId === requestId ? { ...request, ...patch } : request
  )
  state.run.summary = buildSummary(state.run)
}

function markRemainingRequests(state: ActiveRunState, status: Extract<FolderRunRequestStatus, 'cancelled' | 'skipped'>) {
  const now = Date.now()
  state.run.requests = state.run.requests.map(request =>
    request.status === 'pending'
      ? {
          ...request,
          status,
          completedAt: now,
        }
      : request
  )
  state.run.summary = buildSummary(state.run)
}

function finishRun(state: ActiveRunState, status: FolderRunRecord['status']) {
  const completedAt = Date.now()
  state.run.status = status
  state.run.completedAt = completedAt
  state.run.summary = buildSummary(state.run)
  updateFolderRunHistory(state.run)
  activeRunsById.delete(state.run.id)
  activeRunIdByFolderId.delete(state.run.folderId)
  emitGenericEvent({
    type: 'folder-run-completed',
    runId: state.run.id,
    folderId: state.run.folderId,
    status,
    completedAt,
    summary: state.run.summary,
  })
}

function buildSummary(run: FolderRunRecord): FolderRunSummary {
  const summary = createEmptyFolderRunSummary(run.requests.length)
  summary.pendingRequestCount = 0
  for (const request of run.requests) {
    switch (request.status) {
      case 'pending':
        summary.pendingRequestCount += 1
        break
      case 'running':
        summary.runningRequestCount += 1
        break
      case 'passed':
        summary.passedRequestCount += 1
        break
      case 'failed':
        summary.failedRequestCount += 1
        break
      case 'cancelled':
        summary.cancelledRequestCount += 1
        break
      case 'skipped':
        summary.skippedRequestCount += 1
        break
    }

    const testRun = request.execution?.testRun
    if (testRun) {
      summary.totalTestCount += testRun.totalCount
      summary.passedTestCount += testRun.passedCount
      summary.failedTestCount += testRun.failedCount
      summary.skippedTestCount += testRun.skippedCount
    }
  }

  summary.durationMs = run.completedAt ? run.completedAt - run.startedAt : Date.now() - run.startedAt
  return summary
}

function getRequestStatus(execution: RequestExecutionRecord): FolderRunRequestStatus {
  if (execution.responseError || execution.scriptErrors.length > 0 || (execution.testRun?.failedCount ?? 0) > 0) {
    return 'failed'
  }

  return 'passed'
}

function getDescendantFolderIds(items: ExplorerItem[], folderId: string) {
  const folderIds = new Set<string>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) {
      if (item.itemType === 'folder' && item.parentFolderId && folderIds.has(item.parentFolderId) && !folderIds.has(item.id)) {
        folderIds.add(item.id)
        changed = true
      }
    }
  }

  return folderIds
}

function getOverlappingRuns(items: ExplorerItem[], folderId: string): OverlappingFolderRun[] {
  const currentAncestors = getAncestorFolderIds(items, folderId)
  const descendants = getDescendantFolderIds(items, folderId)

  const overlappingRuns: OverlappingFolderRun[] = []
  for (const state of activeRunsById.values()) {
    if (state.run.folderId === folderId) {
      continue
    }

    if (currentAncestors.has(state.run.folderId)) {
      overlappingRuns.push({ runId: state.run.id, folderId: state.run.folderId, folderName: state.run.folderName, relationship: 'ancestor' })
      continue
    }

    if (descendants.has(state.run.folderId)) {
      overlappingRuns.push({ runId: state.run.id, folderId: state.run.folderId, folderName: state.run.folderName, relationship: 'descendant' })
    }
  }

  return overlappingRuns
}

function getAncestorFolderIds(items: ExplorerItem[], folderId: string) {
  const foldersById = new Map(items.filter((item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder').map(item => [item.id, item]))
  const ids = new Set<string>()
  let current = foldersById.get(folderId)?.parentFolderId ?? null
  while (current) {
    ids.add(current)
    current = foldersById.get(current)?.parentFolderId ?? null
  }
  return ids
}

function cloneRun(run: FolderRunRecord): FolderRunRecord {
  return {
    ...run,
    config: { ...run.config, selectedRequestIds: run.config.selectedRequestIds.slice() },
    summary: { ...run.summary },
    requests: run.requests.map(request => ({ ...request })),
    overlappingFolderRunIds: run.overlappingFolderRunIds.slice(),
  }
}
