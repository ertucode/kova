export const REQUEST_BATCH_SOURCE_TYPES = ['csv', 'xlsx', 'json'] as const
export type RequestBatchSourceType = (typeof REQUEST_BATCH_SOURCE_TYPES)[number]

export const REQUEST_BATCH_ROW_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const
export type RequestBatchRowStatus = (typeof REQUEST_BATCH_ROW_STATUSES)[number]

export const REQUEST_BATCH_STATUSES = ['ready', 'running', 'completed', 'failed', 'cancelled'] as const
export type RequestBatchStatus = (typeof REQUEST_BATCH_STATUSES)[number]

export type RequestBatchVariables = Record<string, string>

export type RequestBatchSummary = {
  totalCount: number
  pendingCount: number
  runningCount: number
  completedCount: number
  failedCount: number
  cancelledCount: number
}

export type ParsedRequestBatch = {
  sourceType: RequestBatchSourceType
  sourceFileName: string
  sheetName: string | null
  availableSheetNames: string[]
  columns: string[]
  rows: RequestBatchVariables[]
}

export type ParseRequestBatchFileInput = {
  filePath: string
  sheetName?: string
}

export type PickRequestBatchFileResponse = {
  filePath: string
  sourceFileName: string
  sourceType: RequestBatchSourceType
  sheetNames: string[]
}

export type ImportRequestBatchFileInput = {
  filePath: string
  sheetName?: string
  requestId: string
  requestName: string
  name: string
}

export type RequestBatchRecord = {
  id: string
  requestId: string
  requestName: string
  name: string
  sourceFileName: string
  sourceType: RequestBatchSourceType
  sheetName: string | null
  columns: string[]
  rowCount: number
  status: RequestBatchStatus
  concurrency: number | null
  summary: RequestBatchSummary
  startedAt: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export type RequestBatchRowRecord = {
  id: string
  batchId: string
  rowIndex: number
  variables: RequestBatchVariables
  status: RequestBatchRowStatus
  historyId: string | null
  startedAt: number | null
  completedAt: number | null
  createdAt: number
  updatedAt: number
}

export type CreateRequestBatchInput = {
  requestId: string
  requestName: string
  name: string
  sourceFileName: string
  sourceType: RequestBatchSourceType
  sheetName: string | null
  columns: string[]
  rows: RequestBatchVariables[]
}

export type ListRequestBatchesInput = {
  requestId?: string
  searchQuery: string
  offset: number
  limit: number
}

export type ListRequestBatchesResponse = {
  items: RequestBatchRecord[]
  nextOffset: number | null
  totalCount: number
}

export type GetRequestBatchInput = {
  id: string
  rowSearchQuery?: string
  rowOffset?: number
  rowLimit?: number
}

export type ListRequestBatchRowsInput = {
  batchId: string
  searchQuery: string
  offset: number
  limit: number
}

export type ListRequestBatchRowsResponse = {
  items: RequestBatchRowRecord[]
  nextOffset: number | null
  totalCount: number
}

export type GetRequestBatchResponse = {
  batch: RequestBatchRecord
  rows: RequestBatchRowRecord[]
  nextRowOffset: number | null
  totalRowCount: number
}

export type DeleteRequestBatchInput = {
  id: string
}

export type UpdateRequestBatchRowInput = {
  id: string
  status: RequestBatchRowStatus
  historyId: string | null
  startedAt?: number | null
  completedAt?: number | null
}

export type StartRequestBatchInput = {
  batchId: string
  concurrency: number
  request: import('./Requests.js').SendRequestInput
}

export type StartRequestBatchResponse = {
  batch: RequestBatchRecord
}

export type RunRequestBatchRowInput = {
  batchId: string
  rowId: string
  request: import('./Requests.js').SendRequestInput
}

export type RunRequestBatchRowResponse = {
  batch: RequestBatchRecord
  row: RequestBatchRowRecord
}

export type CancelRequestBatchInput = {
  batchId: string
}

export type ActiveRequestBatchState = {
  batchId: string
  isCancelling: boolean
  activeRowIds: string[]
}
