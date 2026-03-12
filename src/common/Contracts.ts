import { type GenericResult } from './GenericError.js'
import { type CreateFolderInput, type DeleteFolderInput, type FolderRecord, type MoveFolderInput, type RenameFolderInput } from './Folders.js'
import { TaskEvents } from './Tasks.js'
import { GenericEvent } from './GenericEvent.js'
import { type AsyncStorageKey } from './AsyncStorageKeys.js'

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
  listFolders: Promise<FolderRecord[]>
  createFolder: Promise<GenericResult<FolderRecord>>
  renameFolder: Promise<GenericResult<void>>
  deleteFolder: Promise<GenericResult<void>>
  moveFolder: Promise<GenericResult<void>>
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
  listFolders: void
  createFolder: CreateFolderInput
  renameFolder: RenameFolderInput
  deleteFolder: DeleteFolderInput
  moveFolder: MoveFolderInput
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
  listFolders: () => Promise<FolderRecord[]>
  createFolder: (input: CreateFolderInput) => Promise<GenericResult<FolderRecord>>
  renameFolder: (input: RenameFolderInput) => Promise<GenericResult<void>>
  deleteFolder: (input: DeleteFolderInput) => Promise<GenericResult<void>>
  moveFolder: (input: MoveFolderInput) => Promise<GenericResult<void>>
}
