import { type GenericResult } from './GenericError.js'
import {
  type ClearCookiesInput,
  type CookieRecord,
  type CreateCookieInput,
  type DeleteCookieInput,
  type UpdateCookieInput,
} from './Cookies.js'
import { type FolderExplorerTabRecord, type SaveFolderExplorerTabsInput, type UpdateFolderExplorerTabInput } from './FolderExplorerTabs.js'
import {
  type CreateFolderInput,
  type DeleteFolderInput,
  type DeleteFolderResponse,
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
  type DeleteRequestResponse,
  type DeleteWebSocketSavedMessageInput,
  type DuplicateRequestInput,
  type DeleteRequestHistoryEntryInput,
  type DeleteRequestInput,
  type GetRequestHistoryCountInput,
  type GetRequestHistoryCountResponse,
  type GetRequestInput,
  type HttpRequestRecord,
  type ListRecentHttpRequestUsageResponse,
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
import {
  type CreateViewInput,
  type DeleteViewInput,
  type MoveViewInput,
  type UpdateViewInput,
  type ViewRecord,
} from './Views.js'
import { type ScriptPromptResponse } from './ScriptPrompt.js'
import {
  type DatabaseConfigState,
  type DeleteDatabaseConfigInput,
  type PickDatabaseFileInput,
  type PickDatabaseFileResponse,
  type SetActiveDatabaseConfigInput,
  type UpsertDatabaseConfigInput,
} from './DatabaseConfigs.js'
import {
  type DeleteOperationInput,
  type DeleteOperationsInput,
  type ListOperationsInput,
  type OperationRecord,
  type UndoOperationInput,
  type UndoOperationsInput,
} from './Operations.js'
import {
  type CreateSharedScriptInput,
  type DeleteSharedScriptInput,
  type DeleteSharedScriptResponse,
  type ListSharedScriptsInput,
  type ListVisibleSharedScriptsInput,
  type MoveSharedScriptInput,
  type SharedScriptRecord,
  type UpdateSharedScriptInput,
} from './SharedScripts.js'
import {
  type CreateTagInput,
  type DeleteTagInput,
  type MoveTagInput,
  type ReplaceItemTagsInput,
  type ReplaceTagItemsInput,
  type TagAssignmentRecord,
  type TagRecord,
  type UpdateTagInput,
} from './Tags.js'
import {
  type CreateScriptPackageInput,
  type DeleteDownloadedScriptPackageInput,
  type DeleteScriptPackageInput,
  type DownloadScriptPackageInput,
  type ScriptPackageArtifact,
  type ScriptPackageListItem,
  type ScriptPackageRecord,
  type SuggestedScriptPackageVersion,
  type SuggestedTypesScriptPackage,
  type SuggestScriptPackageVersionInput,
  type SuggestTypesScriptPackageInput,
  type UpdateScriptPackageInput,
} from './ScriptPackages.js'
import { type ScriptRequestBridgeResponse } from './ScriptMakeRequest.js'

export type EventResponseMapping = {
  'task:event': TaskEvents
  'generic:event': GenericEvent
  'window:focus': void
  abortTask: Promise<void>
  openShell: Promise<void>
  openFileLocation: Promise<GenericResult<void>>
  pickFilePath: Promise<GenericResult<{ filePath: string }>>
  runCommand: Promise<GenericResult<void>>
  resolveScriptPrompt: Promise<void>
  resolveScriptMakeRequest: Promise<void>
  getParallelPreloadPath: string
  setAlwaysOnTop: Promise<void>
  getAlwaysOnTop: Promise<boolean>
  setCompactWindowSize: Promise<void>
  restoreWindowSize: Promise<void>
  getIsCompactWindowSize: Promise<boolean>
  setAsyncStorageValue: void
  listCookies: Promise<CookieRecord[]>
  createCookie: Promise<GenericResult<CookieRecord>>
  updateCookie: Promise<GenericResult<CookieRecord>>
  deleteCookie: Promise<GenericResult<void>>
  clearCookies: Promise<GenericResult<void>>
  listExplorerItems: Promise<ExplorerItem[]>
  listFolderExplorerTabs: Promise<FolderExplorerTabRecord[]>
  saveFolderExplorerTabs: Promise<GenericResult<void>>
  updateFolderExplorerTab: Promise<GenericResult<void>>
  createFolder: Promise<GenericResult<FolderRecord>>
  getFolder: Promise<GenericResult<FolderRecord>>
  renameFolder: Promise<GenericResult<void>>
  updateFolder: Promise<GenericResult<FolderRecord>>
  deleteFolder: Promise<GenericResult<DeleteFolderResponse>>
  createRequest: Promise<GenericResult<HttpRequestRecord>>
  getRequest: Promise<GenericResult<HttpRequestRecord>>
  updateRequest: Promise<GenericResult<HttpRequestRecord>>
  updateRequestResponseBodyViewPreference: Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: Promise<GenericResult<DeleteRequestResponse>>
  listOperations: Promise<OperationRecord[]>
  undoOperation: Promise<GenericResult<OperationRecord>>
  deleteOperation: Promise<GenericResult<void>>
  undoOperations: Promise<GenericResult<void>>
  deleteOperations: Promise<GenericResult<void>>
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
  getRequestHistoryCount: Promise<GetRequestHistoryCountResponse>
  listRecentHttpRequestUsage: Promise<ListRecentHttpRequestUsageResponse>
  listRequestHistory: Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: Promise<GenericResult<void>>
  trimRequestHistory: Promise<GenericResult<void>>
  getDatabaseConfigState: Promise<DatabaseConfigState>
  pickDatabaseFile: Promise<GenericResult<PickDatabaseFileResponse>>
  upsertDatabaseConfig: Promise<GenericResult<DatabaseConfigState>>
  deleteDatabaseConfig: Promise<GenericResult<DatabaseConfigState>>
  setActiveDatabaseConfig: Promise<GenericResult<DatabaseConfigState>>
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
  listSharedScripts: Promise<SharedScriptRecord[]>
  createSharedScript: Promise<GenericResult<SharedScriptRecord>>
  updateSharedScript: Promise<GenericResult<SharedScriptRecord>>
  deleteSharedScript: Promise<GenericResult<DeleteSharedScriptResponse>>
  moveSharedScript: Promise<GenericResult<void>>
  listVisibleSharedScripts: Promise<SharedScriptRecord[]>
  listViews: Promise<ViewRecord[]>
  createView: Promise<GenericResult<ViewRecord>>
  updateView: Promise<GenericResult<ViewRecord>>
  deleteView: Promise<GenericResult<void>>
  moveView: Promise<GenericResult<void>>
  listTags: Promise<TagRecord[]>
  listTagAssignments: Promise<TagAssignmentRecord[]>
  createTag: Promise<GenericResult<TagRecord>>
  updateTag: Promise<GenericResult<TagRecord>>
  deleteTag: Promise<GenericResult<void>>
  moveTag: Promise<GenericResult<void>>
  replaceItemTags: Promise<GenericResult<void>>
  replaceTagItems: Promise<GenericResult<void>>
  listScriptPackages: Promise<ScriptPackageListItem[]>
  createScriptPackage: Promise<GenericResult<ScriptPackageRecord>>
  updateScriptPackage: Promise<GenericResult<ScriptPackageRecord>>
  deleteScriptPackage: Promise<GenericResult<void>>
  suggestScriptPackageVersion: Promise<GenericResult<SuggestedScriptPackageVersion>>
  suggestTypesScriptPackage: Promise<GenericResult<SuggestedTypesScriptPackage>>
  downloadScriptPackage: Promise<GenericResult<void>>
  deleteDownloadedScriptPackage: Promise<GenericResult<void>>
  getScriptPackageArtifacts: Promise<ScriptPackageArtifact[]>
}

export type EventRequestMapping = {
  abortTask: string
  openShell: string
  openFileLocation: string
  pickFilePath: { defaultPath?: string }
  runCommand: { name: string; filePath: string; parameters: any }
  resolveScriptPrompt: ScriptPromptResponse
  resolveScriptMakeRequest: ScriptRequestBridgeResponse
  setAlwaysOnTop: boolean
  getAlwaysOnTop: void
  setCompactWindowSize: void
  restoreWindowSize: void
  getIsCompactWindowSize: void
  setAsyncStorageValue: { key: AsyncStorageKey; value: $Maybe<string> }
  listCookies: void
  createCookie: CreateCookieInput
  updateCookie: UpdateCookieInput
  deleteCookie: DeleteCookieInput
  clearCookies: ClearCookiesInput | void
  listExplorerItems: void
  listFolderExplorerTabs: void
  saveFolderExplorerTabs: SaveFolderExplorerTabsInput
  updateFolderExplorerTab: UpdateFolderExplorerTabInput
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
  listOperations: ListOperationsInput | void
  undoOperation: UndoOperationInput
  deleteOperation: DeleteOperationInput
  undoOperations: UndoOperationsInput
  deleteOperations: DeleteOperationsInput
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
  getRequestHistoryCount: GetRequestHistoryCountInput
  listRecentHttpRequestUsage: void
  listRequestHistory: ListRequestHistoryInput
  deleteRequestHistoryEntry: DeleteRequestHistoryEntryInput
  trimRequestHistory: TrimRequestHistoryInput
  getDatabaseConfigState: void
  pickDatabaseFile: PickDatabaseFileInput
  upsertDatabaseConfig: UpsertDatabaseConfigInput
  deleteDatabaseConfig: DeleteDatabaseConfigInput
  setActiveDatabaseConfig: SetActiveDatabaseConfigInput
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
  listSharedScripts: ListSharedScriptsInput
  createSharedScript: CreateSharedScriptInput
  updateSharedScript: UpdateSharedScriptInput
  deleteSharedScript: DeleteSharedScriptInput
  moveSharedScript: MoveSharedScriptInput
  listVisibleSharedScripts: ListVisibleSharedScriptsInput
  listViews: void
  createView: CreateViewInput
  updateView: UpdateViewInput
  deleteView: DeleteViewInput
  moveView: MoveViewInput
  listTags: void
  listTagAssignments: void
  createTag: CreateTagInput
  updateTag: UpdateTagInput
  deleteTag: DeleteTagInput
  moveTag: MoveTagInput
  replaceItemTags: ReplaceItemTagsInput
  replaceTagItems: ReplaceTagItemsInput
  listScriptPackages: void
  createScriptPackage: CreateScriptPackageInput
  updateScriptPackage: UpdateScriptPackageInput
  deleteScriptPackage: DeleteScriptPackageInput
  suggestScriptPackageVersion: SuggestScriptPackageVersionInput
  suggestTypesScriptPackage: SuggestTypesScriptPackageInput
  downloadScriptPackage: DownloadScriptPackageInput
  deleteDownloadedScriptPackage: DeleteDownloadedScriptPackageInput
  getScriptPackageArtifacts: void
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
  pickFilePath: (input?: { defaultPath?: string }) => Promise<GenericResult<{ filePath: string }>>
  getWindowArgs: () => string
  runCommand: (opts: { name: string; filePath: string; parameters: any }) => Promise<GenericResult<void>>
  resolveScriptPrompt: (input: ScriptPromptResponse) => Promise<void>
  resolveScriptMakeRequest: (input: ScriptRequestBridgeResponse) => Promise<void>
  setAlwaysOnTop: (alwaysOnTop: boolean) => Promise<void>
  getAlwaysOnTop: () => Promise<boolean>
  setCompactWindowSize: () => Promise<void>
  restoreWindowSize: () => Promise<void>
  getIsCompactWindowSize: () => Promise<boolean>
  listCookies: () => Promise<CookieRecord[]>
  createCookie: (input: CreateCookieInput) => Promise<GenericResult<CookieRecord>>
  updateCookie: (input: UpdateCookieInput) => Promise<GenericResult<CookieRecord>>
  deleteCookie: (input: DeleteCookieInput) => Promise<GenericResult<void>>
  clearCookies: (input?: ClearCookiesInput) => Promise<GenericResult<void>>
  listExplorerItems: () => Promise<ExplorerItem[]>
  listFolderExplorerTabs: () => Promise<FolderExplorerTabRecord[]>
  saveFolderExplorerTabs: (input: SaveFolderExplorerTabsInput) => Promise<GenericResult<void>>
  updateFolderExplorerTab: (input: UpdateFolderExplorerTabInput) => Promise<GenericResult<void>>
  createFolder: (input: CreateFolderInput) => Promise<GenericResult<FolderRecord>>
  getFolder: (input: GetFolderInput) => Promise<GenericResult<FolderRecord>>
  renameFolder: (input: RenameFolderInput) => Promise<GenericResult<void>>
  updateFolder: (input: UpdateFolderInput) => Promise<GenericResult<FolderRecord>>
  deleteFolder: (input: DeleteFolderInput) => Promise<GenericResult<DeleteFolderResponse>>
  createRequest: (input: CreateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  getRequest: (input: GetRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  updateRequest: (input: UpdateRequestInput) => Promise<GenericResult<HttpRequestRecord>>
  updateRequestResponseBodyViewPreference: (
    input: UpdateRequestResponseBodyViewPreferenceInput
  ) => Promise<GenericResult<HttpRequestRecord>>
  deleteRequest: (input: DeleteRequestInput) => Promise<GenericResult<DeleteRequestResponse>>
  listOperations: (input?: ListOperationsInput) => Promise<OperationRecord[]>
  undoOperation: (input: UndoOperationInput) => Promise<GenericResult<OperationRecord>>
  deleteOperation: (input: DeleteOperationInput) => Promise<GenericResult<void>>
  undoOperations: (input: UndoOperationsInput) => Promise<GenericResult<void>>
  deleteOperations: (input: DeleteOperationsInput) => Promise<GenericResult<void>>
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
  getRequestHistoryCount: (input: GetRequestHistoryCountInput) => Promise<GetRequestHistoryCountResponse>
  listRecentHttpRequestUsage: () => Promise<ListRecentHttpRequestUsageResponse>
  listRequestHistory: (input: ListRequestHistoryInput) => Promise<ListRequestHistoryResponse>
  deleteRequestHistoryEntry: (input: DeleteRequestHistoryEntryInput) => Promise<GenericResult<void>>
  trimRequestHistory: (input: TrimRequestHistoryInput) => Promise<GenericResult<void>>
  getDatabaseConfigState: () => Promise<DatabaseConfigState>
  pickDatabaseFile: (input: PickDatabaseFileInput) => Promise<GenericResult<PickDatabaseFileResponse>>
  upsertDatabaseConfig: (input: UpsertDatabaseConfigInput) => Promise<GenericResult<DatabaseConfigState>>
  deleteDatabaseConfig: (input: DeleteDatabaseConfigInput) => Promise<GenericResult<DatabaseConfigState>>
  setActiveDatabaseConfig: (input: SetActiveDatabaseConfigInput) => Promise<GenericResult<DatabaseConfigState>>
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
  listSharedScripts: (input: ListSharedScriptsInput) => Promise<SharedScriptRecord[]>
  createSharedScript: (input: CreateSharedScriptInput) => Promise<GenericResult<SharedScriptRecord>>
  updateSharedScript: (input: UpdateSharedScriptInput) => Promise<GenericResult<SharedScriptRecord>>
  deleteSharedScript: (input: DeleteSharedScriptInput) => Promise<GenericResult<DeleteSharedScriptResponse>>
  moveSharedScript: (input: MoveSharedScriptInput) => Promise<GenericResult<void>>
  listVisibleSharedScripts: (input: ListVisibleSharedScriptsInput) => Promise<SharedScriptRecord[]>
  listViews: () => Promise<ViewRecord[]>
  createView: (input: CreateViewInput) => Promise<GenericResult<ViewRecord>>
  updateView: (input: UpdateViewInput) => Promise<GenericResult<ViewRecord>>
  deleteView: (input: DeleteViewInput) => Promise<GenericResult<void>>
  moveView: (input: MoveViewInput) => Promise<GenericResult<void>>
  listTags: () => Promise<TagRecord[]>
  listTagAssignments: () => Promise<TagAssignmentRecord[]>
  createTag: (input: CreateTagInput) => Promise<GenericResult<TagRecord>>
  updateTag: (input: UpdateTagInput) => Promise<GenericResult<TagRecord>>
  deleteTag: (input: DeleteTagInput) => Promise<GenericResult<void>>
  moveTag: (input: MoveTagInput) => Promise<GenericResult<void>>
  replaceItemTags: (input: ReplaceItemTagsInput) => Promise<GenericResult<void>>
  replaceTagItems: (input: ReplaceTagItemsInput) => Promise<GenericResult<void>>
  listScriptPackages: () => Promise<ScriptPackageListItem[]>
  createScriptPackage: (input: CreateScriptPackageInput) => Promise<GenericResult<ScriptPackageRecord>>
  updateScriptPackage: (input: UpdateScriptPackageInput) => Promise<GenericResult<ScriptPackageRecord>>
  deleteScriptPackage: (input: DeleteScriptPackageInput) => Promise<GenericResult<void>>
  suggestScriptPackageVersion: (
    input: SuggestScriptPackageVersionInput
  ) => Promise<GenericResult<SuggestedScriptPackageVersion>>
  suggestTypesScriptPackage: (
    input: SuggestTypesScriptPackageInput
  ) => Promise<GenericResult<SuggestedTypesScriptPackage>>
  downloadScriptPackage: (input: DownloadScriptPackageInput) => Promise<GenericResult<void>>
  deleteDownloadedScriptPackage: (input: DeleteDownloadedScriptPackageInput) => Promise<GenericResult<void>>
  getScriptPackageArtifacts: () => Promise<ScriptPackageArtifact[]>
}
