import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  createEmptyFolderRunCampaignSummary,
  createEmptyFolderRunSummary,
  type FolderRunCampaignSummary,
  type FolderRunIterationRecord,
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
import { Typescript } from '../common/Typescript.js'
import { getFolder, getFolderAncestorChain } from './db/folders.js'
import { listVisibleEnvironments } from './db/environments.js'
import { listExplorerItems } from './db/explorer.js'
import { getRequest } from './db/requests.js'
import { listVisibleSharedScripts } from './db/shared-scripts.js'
import {
  completeFolderRunIteration,
  createFolderRunHistory,
  createFolderRunIteration,
  recoverStaleFolderRuns,
  updateFolderRunHistory,
} from './db/folder-run-history.js'
import { cancelHttpRequest, sendRequest } from './send-request.js'
import { emitGenericEvent } from './generic-events.js'
import { runFolderIterationScheduler } from './folder-run-scheduler.js'

type SendRequestOptions = Parameters<typeof sendRequest>[1]

type ActiveRunState = {
  run: FolderRunRecord
  activeExecutions: Map<string, string>
  isCancelling: boolean
  progressTimer: ReturnType<typeof setTimeout> | null
  completion: Promise<void> | null
}

type ResolvedFolderRequest = {
  item: Extract<ExplorerItem, { itemType: 'request' }>
  request: HttpRequestRecord
  hasTests: boolean
  position: number
  environmentSnapshot: NonNullable<SendRequestInput['environmentSnapshot']>
  preparationSnapshot: NonNullable<SendRequestInput['preparationSnapshot']>
}

type OverlappingFolderRun = RunFolderRequestsResponse['overlappingRuns'][number]

const activeRunsById = new Map<string, ActiveRunState>()
const activeRunIdByFolderId = new Map<string, string>()
const startingFolderIds = new Set<string>()
let acceptingRuns = true
const MAX_CONCURRENCY = 100
const RETAINED_EDGE_ITERATION_COUNT = 20
const PROGRESS_EVENT_INTERVAL_MS = 300

export async function runFolderRequests(
  input: RunFolderRequestsInput,
  options?: SendRequestOptions
): Promise<GenericResult<RunFolderRequestsResponse>> {
  let startedState: ActiveRunState | null = null
  const validationError = validateInput(input)
  if (validationError) return GenericError.Message(validationError)
  if (!acceptingRuns) return GenericError.Message('Folder runs are temporarily unavailable while switching databases')
  if (activeRunIdByFolderId.has(input.folderId) || startingFolderIds.has(input.folderId)) {
    return GenericError.Message('This folder already has an active run')
  }

  startingFolderIds.add(input.folderId)
  try {
    const folderResult = await getFolder({ id: input.folderId })
    if (!folderResult.success) return folderResult

    const items = await listExplorerItems()
    const overlap = getOverlappingRuns(items, input.folderId)
    const resolvedRequests = await resolveFolderRequests(items, input)
    if (resolvedRequests.length === 0) {
      return GenericError.Message('No requests match this folder run configuration')
    }

    const now = Date.now()
    const targetIterationCount = getTargetIterationCount(input)
    const run: FolderRunRecord = {
      id: crypto.randomUUID(),
      folderId: input.folderId,
      folderName: folderResult.data.name,
      config: {
        ...input.config,
        concurrency: input.config.runMode === 'once' ? 1 : input.config.concurrency,
        selectedRequestIds: input.config.selectedRequestIds.slice(),
      },
      status: 'running',
      summary: createEmptyFolderRunCampaignSummary(targetIterationCount),
      iterations: [],
      overlappingFolderRunIds: overlap.map(item => item.runId),
      startedAt: now,
      completedAt: null,
    }
    const state: ActiveRunState = {
      run,
      activeExecutions: new Map(),
      isCancelling: false,
      progressTimer: null,
      completion: null,
    }
    startedState = state
    activeRunsById.set(run.id, state)
    activeRunIdByFolderId.set(run.folderId, run.id)
    createFolderRunHistory(run)
    emitGenericEvent({ type: 'folder-run-started', run: cloneRun(run) })

    state.completion = executeCampaign(state, resolvedRequests, input, options).catch(error => {
      console.error('folder run campaign failed', error)
      finishCampaign(state, 'failed')
    })
    void state.completion
    return Result.Success({ run: cloneRun(run), overlappingRuns: overlap })
  } catch (error) {
    if (startedState) {
      activeRunsById.delete(startedState.run.id)
      activeRunIdByFolderId.delete(startedState.run.folderId)
    }
    return GenericError.Unknown(error)
  } finally {
    startingFolderIds.delete(input.folderId)
  }
}

export async function cancelFolderRun(input: { runId: string }): Promise<GenericResult<void>> {
  const state = activeRunsById.get(input.runId)
  if (!state) return GenericError.Message('Folder run is not active')
  state.isCancelling = true
  await Promise.all(
    Array.from(state.activeExecutions, ([executionId, requestId]) => cancelHttpRequest({ requestId, executionId }))
  )
  return Result.Success(undefined)
}

export function listActiveFolderRuns() {
  return Array.from(activeRunsById.values(), state => cloneRun(state.run))
}

export function recoverStaleFolderRunCampaigns() {
  recoverStaleFolderRuns()
}

export async function shutdownActiveFolderRuns() {
  const states = Array.from(activeRunsById.values())
  await Promise.all(
    states.flatMap(state => {
      state.isCancelling = true
      return Array.from(state.activeExecutions, ([executionId, requestId]) =>
        cancelHttpRequest({ requestId, executionId })
      )
    })
  )
  await Promise.all(states.map(state => state.completion))
}

export async function pauseAndShutdownFolderRuns() {
  acceptingRuns = false
  while (startingFolderIds.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await shutdownActiveFolderRuns()
}

export function resumeFolderRuns() {
  acceptingRuns = true
}

async function executeCampaign(
  state: ActiveRunState,
  requests: ResolvedFolderRequest[],
  input: RunFolderRequestsInput,
  options: SendRequestOptions | undefined
) {
  const target = state.run.summary.targetIterationCount
  const { workerFailed } = await runFolderIterationScheduler({
    concurrency: input.config.concurrency,
    targetIterationCount: target,
    shouldStop: () => state.isCancelling,
    runIteration: async iterationIndex => {
      try {
        await executeIteration(state, requests, input, iterationIndex, options)
      } catch (error) {
        console.error('folder run iteration failed', error)
        failRunningIteration(state, iterationIndex)
        throw error
      }
    },
  })

  finishCampaign(state, state.isCancelling ? 'cancelled' : workerFailed ? 'failed' : 'completed')
}

function failRunningIteration(state: ActiveRunState, iterationIndex: number) {
  const iteration = state.run.iterations.find(item => item.index === iterationIndex && item.status === 'running')
  if (!iteration) return
  markRemainingRequests(iteration, 'skipped')
  iteration.completedAt = Date.now()
  iteration.status = 'failed'
  iteration.summary = buildIterationSummary(iteration)
  applyCompletedIteration(state.run.summary, iteration)
  try {
    completeFolderRunIteration(state.run, iteration)
  } catch (error) {
    console.error('failed to persist failed folder run iteration', error)
  }
}

async function executeIteration(
  state: ActiveRunState,
  requests: ResolvedFolderRequest[],
  input: RunFolderRequestsInput,
  index: number,
  options: SendRequestOptions | undefined
) {
  const startedAt = Date.now()
  const iteration: FolderRunIterationRecord = {
    id: crypto.randomUUID(),
    runId: state.run.id,
    index,
    status: 'running',
    summary: createEmptyFolderRunSummary(requests.length),
    requests: requests.map(toFolderRunRequest),
    startedAt,
    completedAt: null,
  }
  state.run.summary.runningIterationCount += 1
  state.run.iterations.push(iteration)
  state.run.iterations = retainEdgeIterations(state.run.iterations)
  createFolderRunIteration(state.run, iteration)
  queueProgressEvent(state)

  if (input.config.executionMode === 'parallel') {
    await Promise.all(requests.map(request => executeRequest(state, iteration, request, input, options)))
  } else {
    for (const request of requests) {
      if (state.isCancelling) {
        markRemainingRequests(iteration, 'cancelled')
        break
      }
      await executeRequest(state, iteration, request, input, options)
      if (!input.config.continueOnFailure && iteration.requests.some(item => item.status === 'failed')) {
        markRemainingRequests(iteration, 'skipped')
        break
      }
    }
  }

  iteration.completedAt = Date.now()
  iteration.summary = buildIterationSummary(iteration)
  iteration.status = state.isCancelling ? 'cancelled' : iteration.summary.failedRequestCount > 0 ? 'failed' : 'passed'
  applyCompletedIteration(state.run.summary, iteration)
  state.run.summary.durationMs = Date.now() - state.run.startedAt
  state.run.iterations = retainEdgeIterations(state.run.iterations)
  completeFolderRunIteration(state.run, iteration)
  queueProgressEvent(state)
}

async function executeRequest(
  state: ActiveRunState,
  iteration: FolderRunIterationRecord,
  resolved: ResolvedFolderRequest,
  input: RunFolderRequestsInput,
  options: SendRequestOptions | undefined
) {
  if (state.isCancelling) {
    updateRequestState(iteration, resolved.request.id, { status: 'cancelled', completedAt: Date.now() })
    return
  }
  const startedAt = Date.now()
  const executionId = crypto.randomUUID()
  state.activeExecutions.set(executionId, resolved.request.id)
  updateRequestState(iteration, resolved.request.id, { status: 'running', startedAt })
  queueProgressEvent(state)
  try {
    const result = await sendRequest(
      toSendRequestInput(resolved, input, state.run.id, iteration.id, executionId),
      options
    )
    if (!result.success) {
      updateRequestState(iteration, resolved.request.id, {
        status: state.isCancelling ? 'cancelled' : 'failed',
        error: result.error.type === 'message' ? result.error.message : 'Request failed',
        completedAt: Date.now(),
      })
      return
    }
    const execution = result.data.execution
    updateRequestState(iteration, resolved.request.id, {
      status: state.isCancelling ? 'cancelled' : getRequestStatus(execution),
      execution,
      error: execution.responseError,
      completedAt: execution.response?.receivedAt ?? Date.now(),
    })
  } catch (error) {
    updateRequestState(iteration, resolved.request.id, {
      status: state.isCancelling ? 'cancelled' : 'failed',
      error: error instanceof Error ? error.message : String(error),
      completedAt: Date.now(),
    })
  } finally {
    state.activeExecutions.delete(executionId)
    queueProgressEvent(state)
  }
}

async function resolveFolderRequests(
  items: ExplorerItem[],
  input: RunFolderRequestsInput
): Promise<ResolvedFolderRequest[]> {
  const descendantFolderIds = getDescendantFolderIds(items, input.folderId)
  const requestItems = items
    .filter(
      (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
        item.itemType === 'request' &&
        item.requestType === 'http' &&
        item.parentFolderId !== null &&
        descendantFolderIds.has(item.parentFolderId)
    )
    .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)

  const candidates = await Promise.all(
    requestItems.map(async (item, position) => {
      const requestResult = await getRequest({ id: item.id })
      if (!requestResult.success || requestResult.data.requestType !== 'http') return null
      const sharedScripts = await listVisibleSharedScripts({ folderId: item.parentFolderId, onlyActive: true })
      return {
        item,
        request: requestResult.data,
        hasTests:
          requestResult.data.testScript.trim().length > 0 ||
          sharedScripts.some(script => script.targets.includes('test') && script.code.trim().length > 0),
        position,
        sharedScripts,
      }
    })
  )
  const valid = candidates.filter((item): item is NonNullable<typeof item> => item !== null)
  const selected = (() => {
    switch (input.config.selectionMode) {
      case 'all':
        return valid
      case 'tests-only':
        return valid.filter(item => item.hasTests)
      case 'custom': {
        const selectedIds = new Set(input.config.selectedRequestIds)
        return valid.filter(item => selectedIds.has(item.request.id))
      }
      default:
        return Typescript.assertUnreachable(input.config.selectionMode)
    }
  })()

  return Promise.all(
    selected.map(async item => ({
      item: item.item,
      request: item.request,
      hasTests: item.hasTests,
      position: item.position,
      environmentSnapshot: await listVisibleEnvironments({
        folderId: item.item.parentFolderId,
        activeEnvironmentIds: input.activeEnvironmentIds,
      }),
      preparationSnapshot: {
        requestName: item.request.name,
        folders: await getFolderAncestorChain(item.item.parentFolderId),
        sharedScripts: item.sharedScripts,
      },
    }))
  )
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
  resolved: ResolvedFolderRequest,
  input: RunFolderRequestsInput,
  runId: string,
  iterationId: string,
  executionId: string
): SendRequestInput {
  const request = resolved.request
  return {
    executionId,
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
    environmentSnapshot: resolved.environmentSnapshot.map(environment => ({ ...environment })),
    preparationSnapshot: resolved.preparationSnapshot,
    persistEnvironmentMutations: false,
    saveToHistory: true,
    historyKeepLast: input.historyKeepLast,
    folderRunId: runId,
    folderRunFolderId: input.folderId,
    folderRunIterationId: iterationId,
    suppressSseEvents: true,
    requestMetadata: { sourceRuntime: 'folder-run', isRetry: false, retryCount: 0 },
  }
}

function updateRequestState(
  iteration: FolderRunIterationRecord,
  requestId: string,
  patch: Partial<Omit<FolderRunRequest, 'requestId'>>
) {
  iteration.requests = iteration.requests.map(request =>
    request.requestId === requestId ? { ...request, ...patch } : request
  )
  iteration.summary = buildIterationSummary(iteration)
}

function markRemainingRequests(
  iteration: FolderRunIterationRecord,
  status: Extract<FolderRunRequestStatus, 'cancelled' | 'skipped'>
) {
  const now = Date.now()
  iteration.requests = iteration.requests.map(request =>
    request.status === 'pending' ? { ...request, status, completedAt: now } : request
  )
  iteration.summary = buildIterationSummary(iteration)
}

function buildIterationSummary(iteration: FolderRunIterationRecord): FolderRunSummary {
  const summary = createEmptyFolderRunSummary(iteration.requests.length)
  summary.pendingRequestCount = 0
  for (const request of iteration.requests) {
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
      default:
        Typescript.assertUnreachable(request.status)
    }
    const testRun = request.execution?.testRun
    if (testRun) {
      summary.totalTestCount += testRun.totalCount
      summary.passedTestCount += testRun.passedCount
      summary.failedTestCount += testRun.failedCount
      summary.skippedTestCount += testRun.skippedCount
    }
  }
  summary.durationMs = iteration.completedAt
    ? iteration.completedAt - iteration.startedAt
    : Date.now() - iteration.startedAt
  return summary
}

function applyCompletedIteration(summary: FolderRunCampaignSummary, iteration: FolderRunIterationRecord) {
  summary.runningIterationCount = Math.max(0, summary.runningIterationCount - 1)
  summary.completedIterationCount += 1
  switch (iteration.status) {
    case 'passed':
      summary.passedIterationCount += 1
      break
    case 'failed':
      summary.failedIterationCount += 1
      break
    case 'cancelled':
      summary.cancelledIterationCount += 1
      break
    case 'running':
      break
    default:
      Typescript.assertUnreachable(iteration.status)
  }
  summary.requestCount += iteration.summary.requestCount
  summary.passedRequestCount += iteration.summary.passedRequestCount
  summary.failedRequestCount += iteration.summary.failedRequestCount
  summary.cancelledRequestCount += iteration.summary.cancelledRequestCount
  summary.skippedRequestCount += iteration.summary.skippedRequestCount
  summary.totalTestCount += iteration.summary.totalTestCount
  summary.passedTestCount += iteration.summary.passedTestCount
  summary.failedTestCount += iteration.summary.failedTestCount
  summary.skippedTestCount += iteration.summary.skippedTestCount
  if (iteration.status !== 'cancelled') {
    const duration = iteration.summary.durationMs ?? 0
    summary.totalIterationDurationMs += duration
    const measuredIterationCount = summary.passedIterationCount + summary.failedIterationCount
    summary.averageIterationDurationMs = Math.round(summary.totalIterationDurationMs / measuredIterationCount)
    summary.minIterationDurationMs = Math.min(summary.minIterationDurationMs ?? duration, duration)
    summary.maxIterationDurationMs = Math.max(summary.maxIterationDurationMs ?? duration, duration)
  }
}

function finishCampaign(state: ActiveRunState, status: FolderRunRecord['status']) {
  if (!activeRunsById.has(state.run.id)) return
  if (state.progressTimer) clearTimeout(state.progressTimer)
  const completedAt = Date.now()
  state.run.status = status
  state.run.completedAt = completedAt
  state.run.summary.durationMs = completedAt - state.run.startedAt
  updateFolderRunHistory(state.run)
  activeRunsById.delete(state.run.id)
  activeRunIdByFolderId.delete(state.run.folderId)
  emitGenericEvent({
    type: 'folder-run-completed',
    runId: state.run.id,
    folderId: state.run.folderId,
    status,
    completedAt,
    summary: { ...state.run.summary },
  })
}

function queueProgressEvent(state: ActiveRunState) {
  if (state.progressTimer) return
  state.progressTimer = setTimeout(() => {
    state.progressTimer = null
    state.run.summary.durationMs = Date.now() - state.run.startedAt
    emitGenericEvent({
      type: 'folder-run-progress',
      runId: state.run.id,
      folderId: state.run.folderId,
      summary: { ...state.run.summary },
      iterations: cloneProgressIterations(state.run.iterations),
    })
  }, PROGRESS_EVENT_INTERVAL_MS)
}

function cloneProgressIterations(iterations: FolderRunIterationRecord[]) {
  return iterations.map(iteration => ({
    ...iteration,
    summary: { ...iteration.summary },
    requests: iteration.requests.map(request => ({ ...request, execution: null })),
  }))
}

function getRequestStatus(execution: RequestExecutionRecord): FolderRunRequestStatus {
  return execution.responseError || execution.scriptErrors.length > 0 || (execution.testRun?.failedCount ?? 0) > 0
    ? 'failed'
    : 'passed'
}

function getTargetIterationCount(input: RunFolderRequestsInput) {
  switch (input.config.runMode) {
    case 'once':
      return 1
    case 'repeat':
      return input.config.iterationCount
    case 'continuous':
      return null
    default:
      return Typescript.assertUnreachable(input.config.runMode)
  }
}

function validateInput(input: RunFolderRequestsInput) {
  if (
    !Number.isSafeInteger(input.config.concurrency) ||
    input.config.concurrency < 1 ||
    input.config.concurrency > MAX_CONCURRENCY
  ) {
    return `Concurrent iterations must be between 1 and ${MAX_CONCURRENCY}`
  }
  if (
    input.config.runMode === 'repeat' &&
    (!Number.isSafeInteger(input.config.iterationCount) || input.config.iterationCount < 1)
  ) {
    return 'Iteration count must be a positive integer'
  }
  return null
}

function retainEdgeIterations(iterations: FolderRunIterationRecord[]) {
  const completed = iterations.filter(iteration => iteration.status !== 'running').sort((a, b) => a.index - b.index)
  const running = iterations.filter(iteration => iteration.status === 'running')
  const first = completed.slice(0, RETAINED_EDGE_ITERATION_COUNT)
  const last = completed.slice(-RETAINED_EDGE_ITERATION_COUNT)
  return Array.from(new Map([...first, ...last, ...running].map(iteration => [iteration.id, iteration])).values()).sort(
    (a, b) => a.index - b.index
  )
}

function getDescendantFolderIds(items: ExplorerItem[], folderId: string) {
  const folderIds = new Set<string>([folderId])
  let changed = true
  while (changed) {
    changed = false
    for (const item of items) {
      if (
        item.itemType === 'folder' &&
        item.parentFolderId &&
        folderIds.has(item.parentFolderId) &&
        !folderIds.has(item.id)
      ) {
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
    if (state.run.folderId === folderId) continue
    if (currentAncestors.has(state.run.folderId)) {
      overlappingRuns.push({
        runId: state.run.id,
        folderId: state.run.folderId,
        folderName: state.run.folderName,
        relationship: 'ancestor',
      })
    } else if (descendants.has(state.run.folderId)) {
      overlappingRuns.push({
        runId: state.run.id,
        folderId: state.run.folderId,
        folderName: state.run.folderName,
        relationship: 'descendant',
      })
    }
  }
  return overlappingRuns
}

function getAncestorFolderIds(items: ExplorerItem[], folderId: string) {
  const foldersById = new Map(
    items
      .filter((item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder')
      .map(item => [item.id, item])
  )
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
    iterations: run.iterations.map(iteration => ({
      ...iteration,
      summary: { ...iteration.summary },
      requests: iteration.requests.map(request => ({ ...request })),
    })),
    overlappingFolderRunIds: run.overlappingFolderRunIds.slice(),
  }
}
