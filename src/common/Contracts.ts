import { type GenericResult } from './GenericError.js'
import {
  type CreateFolderInput,
  type DeleteFolderInput,
  type FolderRecord,
  type GetFolderInput,
  type RenameFolderInput,
  type UpdateFolderInput,
} from './Folders.js'
import {
  type CreateEnvironmentInput,
  type DeleteEnvironmentInput,
  type DuplicateEnvironmentInput,
  type EnvironmentRecord,
  type MoveEnvironmentInput,
  type UpdateEnvironmentInput,
} from './Environments.js'
import {
  type CreateRequestExampleInput,
  type DeleteRequestExampleInput,
  type GetRequestExampleInput,
  type MoveRequestExampleInput,
  type RequestExampleRecord,
  type UpdateRequestExampleInput,
} from './RequestExamples.js'
import {
  type CreateRequestInput,
  type DuplicateRequestInput,
  type DeleteRequestHistoryEntryInput,
  type DeleteRequestInput,
  type GetRequestInput,
  type HttpRequestRecord,
  type ListRequestHistoryInput,
  type ListRequestHistoryResponse,
  type SendRequestInput,
  type SendRequestResponse,
  type TrimRequestHistoryInput,
  type UpdateRequestInput,
} from './Requests.js'
import { TaskEvents } from './Tasks.js'
import { GenericEvent } from './GenericEvent.js'
import { type AsyncStorageKey } from './AsyncStorageKeys.js'
import { type ExplorerItem, type MoveExplorerItemInput } from './Explorer.js'
import {
  type AnalyzePostmanCollectionInput,
  type AnalyzePostmanCollectionResponse,
  type ImportPostmanCollectionInput,
  type ImportPostmanCollectionResponse,
  type PickPostmanCollectionFileResponse,
} from './PostmanImport.js'
import {
  type AnalyzePostmanEnvironmentInput,
  type AnalyzePostmanEnvironmentResponse,
  type ImportPostmanEnvironmentInput,
  type ImportPostmanEnvironmentResponse,
  type PickPostmanEnvironmentFileResponse,
} from './PostmanEnvironmentImport.js'

export type EventResponseMapping = {
  'task:event': TaskEvents
  'generic:event': GenericEvent
  'window:focus': void
  abortTask: Promise<void>
  openShell: Promise<void>
  runCommand: Promise<GenericResult<void>>
  getParallelPreloadPath: string
  setAlwaysOnTop: Promise<void>
  getAlwaysOnTop: Promise<boolean>
  setCompactWindowSize: Promise<void>
  restoreWindowSize: Promise<void>
  getIsCompactWindowSize: Promise<boolean>
  setAsyncStorageValue: void
  listExplorerItems: Promise<ExplorerItem[]>
  createFolder: Promise<GenericResult<FolderRecord>>
  getFolder: Promise<GenericResult<FolderRecord>>
  renameFolder: Promise<GenericResult<void>>
  updateFolder: Promise<GenericResult<FolderRecord>>
  deleteFolder: Promise<GenericResult<void>>
  createRequest: Promise<GenericResult<HttpRequestRecord>>
  getRequest: Promise<GenericResult<HttpRequestRecord>>
  updateRequest: Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: Promise<GenericResult<void>>
  duplicateRequest: Promise<GenericResult<HttpRequestRecord>>
  createRequestExample: Promise<GenericResult<RequestExampleRecord>>
  getRequestExample: Promise<GenericResult<RequestExampleRecord>>
  updateRequestExample: Promise<GenericResult<RequestExampleRecord>>
  deleteRequestExample: Promise<GenericResult<void>>
  moveRequestExample: Promise<GenericResult<void>>
  listEnvironments: Promise<EnvironmentRecord[]>
  createEnvironment: Promise<GenericResult<EnvironmentRecord>>
  duplicateEnvironment: Promise<GenericResult<EnvironmentRecord>>
  updateEnvironment: Promise<GenericResult<EnvironmentRecord>>
  deleteEnvironment: Promise<GenericResult<void>>
  moveEnvironment: Promise<GenericResult<void>>
  moveExplorerItem: Promise<GenericResult<void>>
  sendRequest: Promise<GenericResult<SendRequestResponse>>
  listRequestHistory: Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: Promise<GenericResult<void>>
  trimRequestHistory: Promise<GenericResult<void>>
  pickPostmanCollectionFile: Promise<GenericResult<PickPostmanCollectionFileResponse>>
  analyzePostmanCollection: Promise<GenericResult<AnalyzePostmanCollectionResponse>>
  importPostmanCollection: Promise<GenericResult<ImportPostmanCollectionResponse>>
  pickPostmanEnvironmentFile: Promise<GenericResult<PickPostmanEnvironmentFileResponse>>
  analyzePostmanEnvironment: Promise<GenericResult<AnalyzePostmanEnvironmentResponse>>
  importPostmanEnvironment: Promise<GenericResult<ImportPostmanEnvironmentResponse>>
}

export type EventRequestMapping = {
  abortTask: string
  openShell: string
  runCommand: { name: string; filePath: string; parameters: any }
  setAlwaysOnTop: boolean
  getAlwaysOnTop: void
  setCompactWindowSize: void
  restoreWindowSize: void
  getIsCompactWindowSize: void
  setAsyncStorageValue: { key: AsyncStorageKey; value: $Maybe<string> }
  listExplorerItems: void
  createFolder: CreateFolderInput
  getFolder: GetFolderInput
  renameFolder: RenameFolderInput
  updateFolder: UpdateFolderInput
  deleteFolder: DeleteFolderInput
  createRequest: CreateRequestInput
  getRequest: GetRequestInput
  updateRequest: UpdateRequestInput
  deleteRequest: DeleteRequestInput
  duplicateRequest: DuplicateRequestInput
  createRequestExample: CreateRequestExampleInput
  getRequestExample: GetRequestExampleInput
  updateRequestExample: UpdateRequestExampleInput
  deleteRequestExample: DeleteRequestExampleInput
  moveRequestExample: MoveRequestExampleInput
  listEnvironments: void
  createEnvironment: CreateEnvironmentInput
  duplicateEnvironment: DuplicateEnvironmentInput
  updateEnvironment: UpdateEnvironmentInput
  deleteEnvironment: DeleteEnvironmentInput
  moveEnvironment: MoveEnvironmentInput
  moveExplorerItem: MoveExplorerItemInput
  sendRequest: SendRequestInput
  listRequestHistory: ListRequestHistoryInput
  deleteRequestHistoryEntry: DeleteRequestHistoryEntryInput
  trimRequestHistory: TrimRequestHistoryInput
  pickPostmanCollectionFile: void
  analyzePostmanCollection: AnalyzePostmanCollectionInput
  importPostmanCollection: ImportPostmanCollectionInput
  pickPostmanEnvironmentFile: void
  analyzePostmanEnvironment: AnalyzePostmanEnvironmentInput
  importPostmanEnvironment: ImportPostmanEnvironmentInput
}

export type EventRequest<Key extends keyof EventResponseMapping> = Key extends keyof EventRequestMapping
  ? EventRequestMapping[Key]
  : void

export type UnsubscribeFunction = () => void

export type WindowElectron = {
  getParallelPreloadPath: () => Promise<string>
  onTaskEvent: (cb: (e: TaskEvents) => void) => void
  onGenericEvent: (cb: (e: GenericEvent) => void) => void
  onWindowFocus: (cb: () => void) => UnsubscribeFunction
  abortTask: (taskId: string) => Promise<void>
  openShell: (url: string) => Promise<void>
  getWindowArgs: () => string
  runCommand: (opts: { name: string; filePath: string; parameters: any }) => Promise<GenericResult<void>>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
  getAlwaysOnTop: () => Promise<boolean>
  setCompactWindowSize: () => Promise<void>
  restoreWindowSize: () => Promise<void>
  getIsCompactWindowSize: () => Promise<boolean>
  listExplorerItems: () => Promise<ExplorerItem[]>
  createFolder: (input: CreateFolderInput) => Promise<GenericResult<FolderRecord>>
  getFolder: (input: GetFolderInput) => Promise<GenericResult<FolderRecord>>
  renameFolder: (input: RenameFolderInput) => Promise<GenericResult<void>>
  updateFolder: (input: UpdateFolderInput) => Promise<GenericResult<FolderRecord>>
  deleteFolder: (input: DeleteFolderInput) => Promise<GenericResult<void>>
  createRequest: (input: CreateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  getRequest: (input: GetRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  updateRequest: (input: UpdateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: (input: DeleteRequestInput) => Promise<GenericResult<void>>
  duplicateRequest: (input: DuplicateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  createRequestExample: (input: CreateRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  getRequestExample: (input: GetRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  updateRequestExample: (input: UpdateRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  deleteRequestExample: (input: DeleteRequestExampleInput) => Promise<GenericResult<void>>
  moveRequestExample: (input: MoveRequestExampleInput) => Promise<GenericResult<void>>
  listEnvironments: () => Promise<EnvironmentRecord[]>
  createEnvironment: (input: CreateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  duplicateEnvironment: (input: DuplicateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  updateEnvironment: (input: UpdateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  deleteEnvironment: (input: DeleteEnvironmentInput) => Promise<GenericResult<void>>
  moveEnvironment: (input: MoveEnvironmentInput) => Promise<GenericResult<void>>
  moveExplorerItem: (input: MoveExplorerItemInput) => Promise<GenericResult<void>>
  sendRequest: (input: SendRequestInput) => Promise<GenericResult<SendRequestResponse>>
  listRequestHistory: (input: ListRequestHistoryInput) => Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: (input: DeleteRequestHistoryEntryInput) => Promise<GenericResult<void>>
  trimRequestHistory: (input: TrimRequestHistoryInput) => Promise<GenericResult<void>>
  pickPostmanCollectionFile: () => Promise<GenericResult<PickPostmanCollectionFileResponse>>
  analyzePostmanCollection: (input: AnalyzePostmanCollectionInput) => Promise<GenericResult<AnalyzePostmanCollectionResponse>>
  importPostmanCollection: (input: ImportPostmanCollectionInput) => Promise<GenericResult<ImportPostmanCollectionResponse>>
  pickPostmanEnvironmentFile: () => Promise<GenericResult<PickPostmanEnvironmentFileResponse>>
  analyzePostmanEnvironment: (input: AnalyzePostmanEnvironmentInput) => Promise<GenericResult<AnalyzePostmanEnvironmentResponse>>
  importPostmanEnvironment: (input: ImportPostmanEnvironmentInput) => Promise<GenericResult<ImportPostmanEnvironmentResponse>>
}
