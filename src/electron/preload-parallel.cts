import electron from 'electron'
import { EventRequestMapping, EventResponseMapping, WindowElectron } from '../common/Contracts'
import { GenericEvent } from '../common/GenericEvent'
import { TaskEvents } from '../common/Tasks'

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
  listFolders: () => ipcInvoke('listFolders', undefined),
  createFolder: input => ipcInvoke('createFolder', input),
  getFolder: input => ipcInvoke('getFolder', input),
  renameFolder: input => ipcInvoke('renameFolder', input),
  updateFolder: input => ipcInvoke('updateFolder', input),
  deleteFolder: input => ipcInvoke('deleteFolder', input),
  moveFolder: input => ipcInvoke('moveFolder', input),
} satisfies Partial<WindowElectron>)

function getArgv(key: string) {
  const arg = process.argv.find(x => x.startsWith(key))
  const staticData = arg ? arg.replace(key, '') : null
  return staticData
}

function ipcInvoke<Key extends keyof EventResponseMapping>(
  key: Key,
  request: Key extends keyof EventRequestMapping ? EventRequestMapping[Key] : void
) {
  return electron.ipcRenderer.invoke(key, request)
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

electron.ipcRenderer.on('message-to-parallel', (_event, payload) => {
  window.postMessage({ type: payload.type, payload: payload.payload }, '*')
})
