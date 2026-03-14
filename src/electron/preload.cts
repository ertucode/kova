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
  runCommand: (opts: { name: string; filePath: string; parameters: any }) => ipcInvoke('runCommand', opts),
  setAlwaysOnTop: (alwaysOnTop: boolean) => ipcInvoke('setAlwaysOnTop', alwaysOnTop),
  getAlwaysOnTop: () => ipcInvoke('getAlwaysOnTop', undefined),
  setCompactWindowSize: () => ipcInvoke('setCompactWindowSize', undefined),
  restoreWindowSize: () => ipcInvoke('restoreWindowSize', undefined),
  getIsCompactWindowSize: () => ipcInvoke('getIsCompactWindowSize', undefined),
  listExplorerItems: () => ipcInvoke('listExplorerItems', undefined),
  createFolder: input => ipcInvoke('createFolder', input),
  getFolder: input => ipcInvoke('getFolder', input),
  renameFolder: input => ipcInvoke('renameFolder', input),
  updateFolder: input => ipcInvoke('updateFolder', input),
  deleteFolder: input => ipcInvoke('deleteFolder', input),
  createRequest: input => ipcInvoke('createRequest', input),
  getRequest: input => ipcInvoke('getRequest', input),
  updateRequest: input => ipcInvoke('updateRequest', input),
  deleteRequest: input => ipcInvoke('deleteRequest', input),
  listEnvironments: () => ipcInvoke('listEnvironments', undefined),
  createEnvironment: input => ipcInvoke('createEnvironment', input),
  updateEnvironment: input => ipcInvoke('updateEnvironment', input),
  deleteEnvironment: input => ipcInvoke('deleteEnvironment', input),
  moveExplorerItem: input => ipcInvoke('moveExplorerItem', input),
  sendRequest: input => ipcInvoke('sendRequest', input),
  listRequestHistory: input => ipcInvoke('listRequestHistory', input),
  deleteRequestHistoryEntry: input => ipcInvoke('deleteRequestHistoryEntry', input),
  trimRequestHistory: input => ipcInvoke('trimRequestHistory', input),
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
