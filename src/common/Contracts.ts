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
  type CreateRequestInput,
  type DeleteRequestInput,
  type GetRequestInput,
  type HttpRequestRecord,
  type SendRequestInput,
  type SendRequestResponse,
  type UpdateRequestInput,
} from './Requests.js'
import { TaskEvents } from './Tasks.js'
import { GenericEvent } from './GenericEvent.js'
import { type AsyncStorageKey } from './AsyncStorageKeys.js'
import { type ExplorerItem } from './Explorer.js'

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
  sendRequest: Promise<GenericResult<SendRequestResponse>>
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
  sendRequest: SendRequestInput
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
  sendRequest: (input: SendRequestInput) => Promise<GenericResult<SendRequestResponse>>
}
