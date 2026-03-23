import electron from 'electron'
import { EventRequestMapping, EventResponseMapping, WindowElectron } from '../common/Contracts'
import { TaskEvents } from '../common/Tasks'
import { GenericEvent } from '../common/GenericEvent'

electron.contextBridge.exposeInMainWorld('electron', {
  getWindowArgs: () => getArgv('--window-args=')!,
  getParallelPreloadPath: () => ipcInvoke('getParallelPreloadPath', undefined),
  onTaskEvent: (cb: (e: TaskEvents) => void) => {
    const off = ipcOn('task:event', (e: TaskEvents) => cb(e))
    return () => {
      off()
    }
  },
  onGenericEvent: (cb: (e: GenericEvent) => void) => {
    const off = ipcOn('generic:event', (e: GenericEvent) => cb(e))
    return () => {
      off()
    }
  },
  onWindowFocus: (cb: () => void) => {
    const off = ipcOn('window:focus', () => cb())
    return off
  },
  abortTask: (taskId: string) => ipcInvoke('abortTask', taskId),
  openShell: (url: string) => ipcInvoke('openShell', url),
  openFileLocation: (filePath: string) => ipcInvoke('openFileLocation', filePath),
  runCommand: (opts: { name: string; filePath: string; parameters: any }) => ipcInvoke('runCommand', opts),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcInvoke('setAlwaysOnTop', alwaysOnTop),
  getAlwaysOnTop: () => ipcInvoke('getAlwaysOnTop', undefined),
  setCompactWindowSize: () => ipcInvoke('setCompactWindowSize', undefined),
  restoreWindowSize: () => ipcInvoke('restoreWindowSize', undefined),
  getIsCompactWindowSize: () => ipcInvoke('getIsCompactWindowSize', undefined),
  listExplorerItems: () => ipcInvoke('listExplorerItems', undefined),
  listFolderExplorerTabs: () => ipcInvoke('listFolderExplorerTabs', undefined),
  saveFolderExplorerTabs: input => ipcInvoke('saveFolderExplorerTabs', input),
  createFolder: input => ipcInvoke('createFolder', input),
  getFolder: input => ipcInvoke('getFolder', input),
  renameFolder: input => ipcInvoke('renameFolder', input),
  updateFolder: input => ipcInvoke('updateFolder', input),
  deleteFolder: input => ipcInvoke('deleteFolder', input),
  createRequest: input => ipcInvoke('createRequest', input),
  getRequest: input => ipcInvoke('getRequest', input),
  updateRequest: input => ipcInvoke('updateRequest', input),
  updateRequestResponseVisualizerPreference: input => ipcInvoke('updateRequestResponseVisualizerPreference', input),
  deleteRequest: input => ipcInvoke('deleteRequest', input),
  duplicateRequest: input => ipcInvoke('duplicateRequest', input),
  createRequestExample: input => ipcInvoke('createRequestExample', input),
  getRequestExample: input => ipcInvoke('getRequestExample', input),
  updateRequestExample: input => ipcInvoke('updateRequestExample', input),
  deleteRequestExample: input => ipcInvoke('deleteRequestExample', input),
  moveRequestExample: input => ipcInvoke('moveRequestExample', input),
  createWebSocketExample: input => ipcInvoke('createWebSocketExample', input),
  getWebSocketExample: input => ipcInvoke('getWebSocketExample', input),
  updateWebSocketExample: input => ipcInvoke('updateWebSocketExample', input),
  deleteWebSocketExample: input => ipcInvoke('deleteWebSocketExample', input),
  moveWebSocketExample: input => ipcInvoke('moveWebSocketExample', input),
  listEnvironments: () => ipcInvoke('listEnvironments', undefined),
  createEnvironment: input => ipcInvoke('createEnvironment', input),
  duplicateEnvironment: input => ipcInvoke('duplicateEnvironment', input),
  updateEnvironment: input => ipcInvoke('updateEnvironment', input),
  deleteEnvironment: input => ipcInvoke('deleteEnvironment', input),
  moveEnvironment: input => ipcInvoke('moveEnvironment', input),
  moveExplorerItem: input => ipcInvoke('moveExplorerItem', input),
  sendRequest: input => ipcInvoke('sendRequest', input),
  cancelHttpRequest: input => ipcInvoke('cancelHttpRequest', input),
  generateRequestCode: input => ipcInvoke('generateRequestCode', input),
  connectWebSocket: input => ipcInvoke('connectWebSocket', input),
  sendWebSocketMessage: input => ipcInvoke('sendWebSocketMessage', input),
  disconnectWebSocket: input => ipcInvoke('disconnectWebSocket', input),
  listWebSocketSavedMessages: input => ipcInvoke('listWebSocketSavedMessages', input),
  createWebSocketSavedMessage: input => ipcInvoke('createWebSocketSavedMessage', input),
  updateWebSocketSavedMessage: input => ipcInvoke('updateWebSocketSavedMessage', input),
  deleteWebSocketSavedMessage: input => ipcInvoke('deleteWebSocketSavedMessage', input),
  listRequestHistory: input => ipcInvoke('listRequestHistory', input),
  deleteRequestHistoryEntry: input => ipcInvoke('deleteRequestHistoryEntry', input),
  trimRequestHistory: input => ipcInvoke('trimRequestHistory', input),
  pickPostmanCollectionFile: () => ipcInvoke('pickPostmanCollectionFile', undefined),
  analyzePostmanCollection: input => ipcInvoke('analyzePostmanCollection', input),
  importPostmanCollection: input => ipcInvoke('importPostmanCollection', input),
  pickPostmanCollectionExportFile: input => ipcInvoke('pickPostmanCollectionExportFile', input),
  analyzePostmanCollectionExport: input => ipcInvoke('analyzePostmanCollectionExport', input),
  exportPostmanCollection: input => ipcInvoke('exportPostmanCollection', input),
  pickPostmanEnvironmentFile: () => ipcInvoke('pickPostmanEnvironmentFile', undefined),
  analyzePostmanEnvironment: input => ipcInvoke('analyzePostmanEnvironment', input),
  importPostmanEnvironment: input => ipcInvoke('importPostmanEnvironment', input),
  pickPostmanEnvironmentExportFile: input => ipcInvoke('pickPostmanEnvironmentExportFile', input),
  analyzePostmanEnvironmentExport: input => ipcInvoke('analyzePostmanEnvironmentExport', input),
  exportPostmanEnvironment: input => ipcInvoke('exportPostmanEnvironment', input),
} satisfies WindowElectron)

function ipcInvoke<Key extends keyof EventResponseMapping>(
  key: Key,
  request: Key extends keyof EventRequestMapping ? EventRequestMapping[Key] : void
) {
  return electron.ipcRenderer.invoke(key, request)
}

function getArgv(key: string) {
  const arg = process.argv.find(x => x.startsWith(key))
  const staticData = arg ? arg.replace(key, '') : null
  return staticData
}

function ipcOn<Key extends keyof EventResponseMapping>(
  key: Key,
  callback: (payload: EventResponseMapping[Key]) => void
) {
  const cb = (_: Electron.IpcRendererEvent, payload: EventResponseMapping[Key]) => {
    callback(payload)
  }
  electron.ipcRenderer.on(key, cb)

  return () => {
    electron.ipcRenderer.off(key, cb)
  }
}
