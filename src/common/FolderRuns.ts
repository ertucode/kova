import type { RequestExecutionRecord } from './Requests.js'

export const FOLDER_REQUEST_SELECTION_MODES = ['all', 'tests-only', 'custom'] as const
export type FolderRequestSelectionMode = (typeof FOLDER_REQUEST_SELECTION_MODES)[number]

export const FOLDER_REQUEST_EXECUTION_MODES = ['sequential', 'parallel'] as const
export type FolderRequestExecutionMode = (typeof FOLDER_REQUEST_EXECUTION_MODES)[number]

export const FOLDER_RUN_MODES = ['once', 'repeat', 'continuous'] as const
export type FolderRunMode = (typeof FOLDER_RUN_MODES)[number]

export const FOLDER_RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled'] as const
export type FolderRunStatus = (typeof FOLDER_RUN_STATUSES)[number]

export const FOLDER_RUN_REQUEST_STATUSES = ['pending', 'running', 'passed', 'failed', 'cancelled', 'skipped'] as const
export type FolderRunRequestStatus = (typeof FOLDER_RUN_REQUEST_STATUSES)[number]

export type FolderRequestRunConfig = {
  selectionMode: FolderRequestSelectionMode
  selectedRequestIds: string[]
  executionMode: FolderRequestExecutionMode
  continueOnFailure: boolean
  runMode: FolderRunMode
  iterationCount: number
  concurrency: number
}

export const FOLDER_RUN_ITERATION_STATUSES = ['running', 'passed', 'failed', 'cancelled'] as const
export type FolderRunIterationStatus = (typeof FOLDER_RUN_ITERATION_STATUSES)[number]

export type FolderRunSummary = {
  requestCount: number
  pendingRequestCount: number
  runningRequestCount: number
  passedRequestCount: number
  failedRequestCount: number
  cancelledRequestCount: number
  skippedRequestCount: number
  totalTestCount: number
  passedTestCount: number
  failedTestCount: number
  skippedTestCount: number
  durationMs: number | null
}

export type FolderRunCampaignSummary = FolderRunSummary & {
  targetIterationCount: number | null
  completedIterationCount: number
  passedIterationCount: number
  failedIterationCount: number
  cancelledIterationCount: number
  runningIterationCount: number
  totalIterationDurationMs: number
  averageIterationDurationMs: number | null
  minIterationDurationMs: number | null
  maxIterationDurationMs: number | null
}

export type FolderRunRequest = {
  requestId: string
  requestName: string
  method: string
  url: string
  position: number
  hasTests: boolean
  status: FolderRunRequestStatus
  execution: RequestExecutionRecord | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export type FolderRunRecord = {
  id: string
  folderId: string
  folderName: string
  config: FolderRequestRunConfig
  status: FolderRunStatus
  summary: FolderRunCampaignSummary
  iterations: FolderRunIterationRecord[]
  overlappingFolderRunIds: string[]
  startedAt: number
  completedAt: number | null
}

export type FolderRunIterationRecord = {
  id: string
  runId: string
  index: number
  status: FolderRunIterationStatus
  summary: FolderRunSummary
  requests: FolderRunRequest[]
  startedAt: number
  completedAt: number | null
}

export type FolderRunHistoryRecord = {
  id: string
  folderId: string
  folderName: string
  config: FolderRequestRunConfig
  status: FolderRunStatus
  summary: FolderRunCampaignSummary
  requestCount: number
  passedRequestCount: number
  failedRequestCount: number
  startedAt: number
  completedAt: number | null
}

export type RunFolderRequestsInput = {
  folderId: string
  config: FolderRequestRunConfig
  activeEnvironmentIds: string[]
  historyKeepLast: number
}

export type RunFolderRequestsResponse = {
  run: FolderRunRecord
  overlappingRuns: Array<{
    runId: string
    folderId: string
    folderName: string
    relationship: 'ancestor' | 'descendant'
  }>
}

export type CancelFolderRunInput = {
  runId: string
}

export type DeleteFolderRunHistoryInput = {
  runId: string
}

export type ListFolderRunHistoryInput = {
  folderId: string
  offset: number
  limit: number
}

export type ListFolderRunHistoryResponse = {
  items: FolderRunHistoryRecord[]
  nextOffset: number | null
  totalCount: number
}

export type GetFolderRunHistoryInput = {
  id: string
}

export type GetFolderRunHistoryResponse = {
  run: FolderRunHistoryRecord
  iterations: FolderRunIterationRecord[]
}

export function createDefaultFolderRequestRunConfig(): FolderRequestRunConfig {
  return {
    selectionMode: 'tests-only',
    selectedRequestIds: [],
    executionMode: 'sequential',
    continueOnFailure: true,
    runMode: 'once',
    iterationCount: 1,
    concurrency: 1,
  }
}

export function createEmptyFolderRunCampaignSummary(targetIterationCount: number | null): FolderRunCampaignSummary {
  return {
    ...createEmptyFolderRunSummary(),
    targetIterationCount,
    completedIterationCount: 0,
    passedIterationCount: 0,
    failedIterationCount: 0,
    cancelledIterationCount: 0,
    runningIterationCount: 0,
    totalIterationDurationMs: 0,
    averageIterationDurationMs: null,
    minIterationDurationMs: null,
    maxIterationDurationMs: null,
  }
}

export function createEmptyFolderRunSummary(requestCount = 0): FolderRunSummary {
  return {
    requestCount,
    pendingRequestCount: requestCount,
    runningRequestCount: 0,
    passedRequestCount: 0,
    failedRequestCount: 0,
    cancelledRequestCount: 0,
    skippedRequestCount: 0,
    totalTestCount: 0,
    passedTestCount: 0,
    failedTestCount: 0,
    skippedTestCount: 0,
    durationMs: null,
  }
}
