import { type GenericResult } from './GenericError.js'
import { type FolderExplorerTabRecord, type SaveFolderExplorerTabsInput } from './FolderExplorerTabs.js'
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
  type CreateWebSocketExampleInput,
  type DeleteWebSocketExampleInput,
  type GetWebSocketExampleInput,
  type MoveWebSocketExampleInput,
  type UpdateWebSocketExampleInput,
  type WebSocketExampleRecord,
} from './WebSocketExamples.js'
import {
  type CancelHttpRequestInput,
  type CreateRequestInput,
  type CreateWebSocketSavedMessageInput,
  type DeleteWebSocketSavedMessageInput,
  type DuplicateRequestInput,
  type DeleteRequestHistoryEntryInput,
  type DeleteRequestInput,
  type GetRequestInput,
  type HttpRequestRecord,
  type ListRequestHistoryInput,
  type ListRequestHistoryResponse,
  type ListWebSocketSavedMessagesInput,
  type SendRequestInput,
  type SendRequestResponse,
  type TrimRequestHistoryInput,
  type UpdateRequestInput,
  type UpdateRequestResponseBodyViewPreferenceInput,
  type UpdateWebSocketSavedMessageInput,
  type WebSocketConnectInput,
  type WebSocketConnectResponse,
  type WebSocketDisconnectInput,
  type WebSocketSavedMessageRecord,
  type WebSocketSendMessageInput,
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
import {
  type AnalyzePostmanCollectionExportInput,
  type AnalyzePostmanCollectionExportResponse,
  type ExportPostmanCollectionInput,
  type ExportPostmanCollectionResponse,
  type PickPostmanCollectionExportFileInput,
  type PickPostmanCollectionExportFileResponse,
} from './PostmanExport.js'
import {
  type AnalyzePostmanEnvironmentExportInput,
  type AnalyzePostmanEnvironmentExportResponse,
  type ExportPostmanEnvironmentInput,
  type ExportPostmanEnvironmentResponse,
  type PickPostmanEnvironmentExportFileInput,
  type PickPostmanEnvironmentExportFileResponse,
} from './PostmanEnvironmentExport.js'
import { type GenerateRequestCodeInput, type GenerateRequestCodeResponse } from './RequestCodegen.js'
import { type AppSettingsRecord, type UpdateAppSettingsInput } from './AppSettings.js'

export type EventResponseMapping = {
  'task:event': TaskEvents
  'generic:event': GenericEvent
  'window:focus': void
  abortTask: Promise<void>
  openShell: Promise<void>
  openFileLocation: Promise<GenericResult<void>>
  runCommand: Promise<GenericResult<void>>
  getParallelPreloadPath: string
  setAlwaysOnTop: Promise<void>
  getAlwaysOnTop: Promise<boolean>
  setCompactWindowSize: Promise<void>
  restoreWindowSize: Promise<void>
  getIsCompactWindowSize: Promise<boolean>
  setAsyncStorageValue: void
  listExplorerItems: Promise<ExplorerItem[]>
  listFolderExplorerTabs: Promise<FolderExplorerTabRecord[]>
  saveFolderExplorerTabs: Promise<GenericResult<void>>
  createFolder: Promise<GenericResult<FolderRecord>>
  getFolder: Promise<GenericResult<FolderRecord>>
  renameFolder: Promise<GenericResult<void>>
  updateFolder: Promise<GenericResult<FolderRecord>>
  deleteFolder: Promise<GenericResult<void>>
  createRequest: Promise<GenericResult<HttpRequestRecord>>
  getRequest: Promise<GenericResult<HttpRequestRecord>>
  updateRequest: Promise<GenericResult<HttpRequestRecord>>
  updateRequestResponseBodyViewPreference: Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: Promise<GenericResult<void>>
  duplicateRequest: Promise<GenericResult<HttpRequestRecord>>
  createRequestExample: Promise<GenericResult<RequestExampleRecord>>
  getRequestExample: Promise<GenericResult<RequestExampleRecord>>
  updateRequestExample: Promise<GenericResult<RequestExampleRecord>>
  deleteRequestExample: Promise<GenericResult<void>>
  moveRequestExample: Promise<GenericResult<void>>
  createWebSocketExample: Promise<GenericResult<WebSocketExampleRecord>>
  getWebSocketExample: Promise<GenericResult<WebSocketExampleRecord>>
  updateWebSocketExample: Promise<GenericResult<WebSocketExampleRecord>>
  deleteWebSocketExample: Promise<GenericResult<void>>
  moveWebSocketExample: Promise<GenericResult<void>>
  listEnvironments: Promise<EnvironmentRecord[]>
  getAppSettings: Promise<AppSettingsRecord>
  createEnvironment: Promise<GenericResult<EnvironmentRecord>>
  duplicateEnvironment: Promise<GenericResult<EnvironmentRecord>>
  updateEnvironment: Promise<GenericResult<EnvironmentRecord>>
  updateAppSettings: Promise<GenericResult<AppSettingsRecord>>
  deleteEnvironment: Promise<GenericResult<void>>
  moveEnvironment: Promise<GenericResult<void>>
  moveExplorerItem: Promise<GenericResult<void>>
  sendRequest: Promise<GenericResult<SendRequestResponse>>
  cancelHttpRequest: Promise<GenericResult<void>>
  generateRequestCode: Promise<GenericResult<GenerateRequestCodeResponse>>
  connectWebSocket: Promise<GenericResult<WebSocketConnectResponse>>
  sendWebSocketMessage: Promise<GenericResult<void>>
  disconnectWebSocket: Promise<GenericResult<void>>
  listWebSocketSavedMessages: Promise<WebSocketSavedMessageRecord[]>
  createWebSocketSavedMessage: Promise<GenericResult<WebSocketSavedMessageRecord>>
  updateWebSocketSavedMessage: Promise<GenericResult<WebSocketSavedMessageRecord>>
  deleteWebSocketSavedMessage: Promise<GenericResult<void>>
  listRequestHistory: Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: Promise<GenericResult<void>>
  trimRequestHistory: Promise<GenericResult<void>>
  pickPostmanCollectionFile: Promise<GenericResult<PickPostmanCollectionFileResponse>>
  analyzePostmanCollection: Promise<GenericResult<AnalyzePostmanCollectionResponse>>
  importPostmanCollection: Promise<GenericResult<ImportPostmanCollectionResponse>>
  pickPostmanCollectionExportFile: Promise<GenericResult<PickPostmanCollectionExportFileResponse>>
  analyzePostmanCollectionExport: Promise<GenericResult<AnalyzePostmanCollectionExportResponse>>
  exportPostmanCollection: Promise<GenericResult<ExportPostmanCollectionResponse>>
  pickPostmanEnvironmentFile: Promise<GenericResult<PickPostmanEnvironmentFileResponse>>
  analyzePostmanEnvironment: Promise<GenericResult<AnalyzePostmanEnvironmentResponse>>
  importPostmanEnvironment: Promise<GenericResult<ImportPostmanEnvironmentResponse>>
  pickPostmanEnvironmentExportFile: Promise<GenericResult<PickPostmanEnvironmentExportFileResponse>>
  analyzePostmanEnvironmentExport: Promise<GenericResult<AnalyzePostmanEnvironmentExportResponse>>
  exportPostmanEnvironment: Promise<GenericResult<ExportPostmanEnvironmentResponse>>
}

export type EventRequestMapping = {
  abortTask: string
  openShell: string
  openFileLocation: string
  runCommand: { name: string; filePath: string; parameters: any }
  setAlwaysOnTop: boolean
  getAlwaysOnTop: void
  setCompactWindowSize: void
  restoreWindowSize: void
  getIsCompactWindowSize: void
  setAsyncStorageValue: { key: AsyncStorageKey; value: $Maybe<string> }
  listExplorerItems: void
  listFolderExplorerTabs: void
  saveFolderExplorerTabs: SaveFolderExplorerTabsInput
  createFolder: CreateFolderInput
  getFolder: GetFolderInput
  renameFolder: RenameFolderInput
  updateFolder: UpdateFolderInput
  deleteFolder: DeleteFolderInput
  createRequest: CreateRequestInput
  getRequest: GetRequestInput
  updateRequest: UpdateRequestInput
  updateRequestResponseBodyViewPreference: UpdateRequestResponseBodyViewPreferenceInput
  deleteRequest: DeleteRequestInput
  duplicateRequest: DuplicateRequestInput
  createRequestExample: CreateRequestExampleInput
  getRequestExample: GetRequestExampleInput
  updateRequestExample: UpdateRequestExampleInput
  deleteRequestExample: DeleteRequestExampleInput
  moveRequestExample: MoveRequestExampleInput
  createWebSocketExample: CreateWebSocketExampleInput
  getWebSocketExample: GetWebSocketExampleInput
  updateWebSocketExample: UpdateWebSocketExampleInput
  deleteWebSocketExample: DeleteWebSocketExampleInput
  moveWebSocketExample: MoveWebSocketExampleInput
  listEnvironments: void
  getAppSettings: void
  createEnvironment: CreateEnvironmentInput
  duplicateEnvironment: DuplicateEnvironmentInput
  updateEnvironment: UpdateEnvironmentInput
  updateAppSettings: UpdateAppSettingsInput
  deleteEnvironment: DeleteEnvironmentInput
  moveEnvironment: MoveEnvironmentInput
  moveExplorerItem: MoveExplorerItemInput
  sendRequest: SendRequestInput
  cancelHttpRequest: CancelHttpRequestInput
  generateRequestCode: GenerateRequestCodeInput
  connectWebSocket: WebSocketConnectInput
  sendWebSocketMessage: WebSocketSendMessageInput
  disconnectWebSocket: WebSocketDisconnectInput
  listWebSocketSavedMessages: ListWebSocketSavedMessagesInput
  createWebSocketSavedMessage: CreateWebSocketSavedMessageInput
  updateWebSocketSavedMessage: UpdateWebSocketSavedMessageInput
  deleteWebSocketSavedMessage: DeleteWebSocketSavedMessageInput
  listRequestHistory: ListRequestHistoryInput
  deleteRequestHistoryEntry: DeleteRequestHistoryEntryInput
  trimRequestHistory: TrimRequestHistoryInput
  pickPostmanCollectionFile: void
  analyzePostmanCollection: AnalyzePostmanCollectionInput
  importPostmanCollection: ImportPostmanCollectionInput
  pickPostmanCollectionExportFile: PickPostmanCollectionExportFileInput
  analyzePostmanCollectionExport: AnalyzePostmanCollectionExportInput
  exportPostmanCollection: ExportPostmanCollectionInput
  pickPostmanEnvironmentFile: void
  analyzePostmanEnvironment: AnalyzePostmanEnvironmentInput
  importPostmanEnvironment: ImportPostmanEnvironmentInput
  pickPostmanEnvironmentExportFile: PickPostmanEnvironmentExportFileInput
  analyzePostmanEnvironmentExport: AnalyzePostmanEnvironmentExportInput
  exportPostmanEnvironment: ExportPostmanEnvironmentInput
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
  openFileLocation: (filePath: string) => Promise<GenericResult<void>>
  getWindowArgs: () => string
  runCommand: (opts: { name: string; filePath: string; parameters: any }) => Promise<GenericResult<void>>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
  getAlwaysOnTop: () => Promise<boolean>
  setCompactWindowSize: () => Promise<void>
  restoreWindowSize: () => Promise<void>
  getIsCompactWindowSize: () => Promise<boolean>
  listExplorerItems: () => Promise<ExplorerItem[]>
  listFolderExplorerTabs: () => Promise<FolderExplorerTabRecord[]>
  saveFolderExplorerTabs: (input: SaveFolderExplorerTabsInput) => Promise<GenericResult<void>>
  createFolder: (input: CreateFolderInput) => Promise<GenericResult<FolderRecord>>
  getFolder: (input: GetFolderInput) => Promise<GenericResult<FolderRecord>>
  renameFolder: (input: RenameFolderInput) => Promise<GenericResult<void>>
  updateFolder: (input: UpdateFolderInput) => Promise<GenericResult<FolderRecord>>
  deleteFolder: (input: DeleteFolderInput) => Promise<GenericResult<void>>
  createRequest: (input: CreateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  getRequest: (input: GetRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  updateRequest: (input: UpdateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  updateRequestResponseBodyViewPreference: (
    input: UpdateRequestResponseBodyViewPreferenceInput
  ) => Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: (input: DeleteRequestInput) => Promise<GenericResult<void>>
  duplicateRequest: (input: DuplicateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  createRequestExample: (input: CreateRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  getRequestExample: (input: GetRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  updateRequestExample: (input: UpdateRequestExampleInput) => Promise<GenericResult<RequestExampleRecord>>
  deleteRequestExample: (input: DeleteRequestExampleInput) => Promise<GenericResult<void>>
  moveRequestExample: (input: MoveRequestExampleInput) => Promise<GenericResult<void>>
  createWebSocketExample: (input: CreateWebSocketExampleInput) => Promise<GenericResult<WebSocketExampleRecord>>
  getWebSocketExample: (input: GetWebSocketExampleInput) => Promise<GenericResult<WebSocketExampleRecord>>
  updateWebSocketExample: (input: UpdateWebSocketExampleInput) => Promise<GenericResult<WebSocketExampleRecord>>
  deleteWebSocketExample: (input: DeleteWebSocketExampleInput) => Promise<GenericResult<void>>
  moveWebSocketExample: (input: MoveWebSocketExampleInput) => Promise<GenericResult<void>>
  listEnvironments: () => Promise<EnvironmentRecord[]>
  getAppSettings: () => Promise<AppSettingsRecord>
  createEnvironment: (input: CreateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  duplicateEnvironment: (input: DuplicateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  updateEnvironment: (input: UpdateEnvironmentInput) => Promise<GenericResult<EnvironmentRecord>>
  updateAppSettings: (input: UpdateAppSettingsInput) => Promise<GenericResult<AppSettingsRecord>>
  deleteEnvironment: (input: DeleteEnvironmentInput) => Promise<GenericResult<void>>
  moveEnvironment: (input: MoveEnvironmentInput) => Promise<GenericResult<void>>
  moveExplorerItem: (input: MoveExplorerItemInput) => Promise<GenericResult<void>>
  sendRequest: (input: SendRequestInput) => Promise<GenericResult<SendRequestResponse>>
  cancelHttpRequest: (input: CancelHttpRequestInput) => Promise<GenericResult<void>>
  generateRequestCode: (input: GenerateRequestCodeInput) => Promise<GenericResult<GenerateRequestCodeResponse>>
  connectWebSocket: (input: WebSocketConnectInput) => Promise<GenericResult<WebSocketConnectResponse>>
  sendWebSocketMessage: (input: WebSocketSendMessageInput) => Promise<GenericResult<void>>
  disconnectWebSocket: (input: WebSocketDisconnectInput) => Promise<GenericResult<void>>
  listWebSocketSavedMessages: (input: ListWebSocketSavedMessagesInput) => Promise<WebSocketSavedMessageRecord[]>
  createWebSocketSavedMessage: (input: CreateWebSocketSavedMessageInput) => Promise<GenericResult<WebSocketSavedMessageRecord>>
  updateWebSocketSavedMessage: (input: UpdateWebSocketSavedMessageInput) => Promise<GenericResult<WebSocketSavedMessageRecord>>
  deleteWebSocketSavedMessage: (input: DeleteWebSocketSavedMessageInput) => Promise<GenericResult<void>>
  listRequestHistory: (input: ListRequestHistoryInput) => Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: (input: DeleteRequestHistoryEntryInput) => Promise<GenericResult<void>>
  trimRequestHistory: (input: TrimRequestHistoryInput) => Promise<GenericResult<void>>
  pickPostmanCollectionFile: () => Promise<GenericResult<PickPostmanCollectionFileResponse>>
  analyzePostmanCollection: (input: AnalyzePostmanCollectionInput) => Promise<GenericResult<AnalyzePostmanCollectionResponse>>
  importPostmanCollection: (input: ImportPostmanCollectionInput) => Promise<GenericResult<ImportPostmanCollectionResponse>>
  pickPostmanCollectionExportFile: (input: PickPostmanCollectionExportFileInput) => Promise<GenericResult<PickPostmanCollectionExportFileResponse>>
  analyzePostmanCollectionExport: (input: AnalyzePostmanCollectionExportInput) => Promise<GenericResult<AnalyzePostmanCollectionExportResponse>>
  exportPostmanCollection: (input: ExportPostmanCollectionInput) => Promise<GenericResult<ExportPostmanCollectionResponse>>
  pickPostmanEnvironmentFile: () => Promise<GenericResult<PickPostmanEnvironmentFileResponse>>
  analyzePostmanEnvironment: (input: AnalyzePostmanEnvironmentInput) => Promise<GenericResult<AnalyzePostmanEnvironmentResponse>>
  importPostmanEnvironment: (input: ImportPostmanEnvironmentInput) => Promise<GenericResult<ImportPostmanEnvironmentResponse>>
  pickPostmanEnvironmentExportFile: (input: PickPostmanEnvironmentExportFileInput) => Promise<GenericResult<PickPostmanEnvironmentExportFileResponse>>
  analyzePostmanEnvironmentExport: (input: AnalyzePostmanEnvironmentExportInput) => Promise<GenericResult<AnalyzePostmanEnvironmentExportResponse>>
  exportPostmanEnvironment: (input: ExportPostmanEnvironmentInput) => Promise<GenericResult<ExportPostmanEnvironmentResponse>>
}
