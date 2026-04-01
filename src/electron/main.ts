import { app, BrowserWindow, Menu, screen, shell, clipboard, dialog } from 'electron'
import path from 'path'
import os from 'os'
import { ipcHandle, isDev } from './util.js'
import { getPreloadPath, getUIPath } from './pathResolver.js'
import { TaskManager } from './TaskManager.js'
import { initializeDatabase } from './db/index.js'
import { getAppSettings, updateAppSettings } from './db/app-settings.js'
import { listExplorerItems } from './db/explorer.js'
import { listFolderExplorerTabs, saveFolderExplorerTabs } from './db/folder-explorer-tabs.js'
import { createFolder, deleteFolder, getFolder, renameFolder, updateFolder } from './db/folders.js'
import {
  createEnvironment,
  deleteEnvironment,
  duplicateEnvironment,
  listEnvironments,
  moveEnvironment,
  updateEnvironment,
} from './db/environments.js'
import { deleteRequestHistoryEntry, listRequestHistory, trimRequestHistory } from './db/request-history.js'
import {
  createRequest,
  deleteRequest,
  duplicateRequest,
  getRequest,
  updateRequest,
  updateRequestResponseBodyViewPreference,
} from './db/requests.js'
import {
  createRequestExample,
  deleteRequestExample,
  getRequestExample,
  moveRequestExample,
  updateRequestExample,
} from './db/request-examples.js'
import {
  createWebSocketExample,
  deleteWebSocketExample,
  getWebSocketExample,
  moveWebSocketExample,
  updateWebSocketExample,
} from './db/websocket-examples.js'
import {
  createWebSocketSavedMessage,
  deleteWebSocketSavedMessage,
  listWebSocketSavedMessages,
  updateWebSocketSavedMessage,
} from './db/websocket-saved-messages.js'
import { moveExplorerItem } from './db/tree-items.js'
import { deleteOperation, deleteOperations, listOperations, undoOperation, undoOperations } from './db/operations.js'
import { cancelHttpRequest, sendRequest } from './send-request.js'
import { buildCurlCommand, buildFetchSnippet, prepareHttpRequest } from './http-request-runtime.js'
import { connectWebSocket, disconnectWebSocket, sendWebSocketMessage } from './websocket-runtime.js'
import { analyzePostmanCollection, importPostmanCollection } from './postman-import.js'
import { analyzePostmanEnvironment, importPostmanEnvironment } from './postman-environment-import.js'
import { analyzePostmanCollectionExport, exportPostmanCollection } from './postman-export.js'
import { analyzePostmanEnvironmentExport, exportPostmanEnvironment } from './postman-environment-export.js'
import { serializeWindowArguments, WindowArguments } from '../common/WindowArguments.js'
import { runCommand } from './utils/run-command.js'
import { getServerConfig } from './server-config.js'
import { GenericError } from '../common/GenericError.js'
import { Result } from '../common/Result.js'

// Handle folders/files opened via "open with" or as default app
let pendingOpenPath: string | undefined

app.on('open-file', (event, path) => {
  event.preventDefault()
  pendingOpenPath = path

  // If app is already ready, create a new window with this path
  if (app.isReady()) {
    createWindow({
      initialPath: path,
    })
  }
})

type WindowArgsWithoutStatic = Omit<WindowArguments, 'homeDir' | 'asyncStorage' | 'isDev'>

const homeDir = os.homedir()

async function createWindow(args?: WindowArgsWithoutStatic) {
  const windowArgs: WindowArguments = {
    ...args,
    homeDir,
    isDev: process.env.NODE_ENV === 'development',
  }
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  const config = await getServerConfig()
  windowArgs.commands = config.commands?.map(s => {
    const { command, ...others } = s
    return others
  })

  const isSelectMode = windowArgs.mode === 'select-app'
  const mainWindow = new BrowserWindow({
    width: isSelectMode ? 900 : width,
    height: isSelectMode ? 600 : height,
    x: isSelectMode ? undefined : 0,
    y: isSelectMode ? undefined : 0,
    backgroundColor: '#282a36',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 16 },
    modal: isSelectMode,
    webPreferences: {
      preload: getPreloadPath(),
      webviewTag: true,
      additionalArguments: ['--window-args=' + serializeWindowArguments(windowArgs)],
      webSecurity: false,
    },
  })

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5123')
  } else {
    mainWindow.loadFile(getUIPath())
  }

  return mainWindow
}

app.on('ready', () => {
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow()
          },
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          role: 'close',
        },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { type: 'separator' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          role: 'toggleDevTools',
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'Ctrl+Command+F',
          role: 'togglefullscreen',
        },
      ],
    },
  ]
  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)

  app.on('web-contents-created', (_event, contents) => {
    // if (contents.getType() === 'webview') return

    contents.on('context-menu', (_contextEvent, params) => {
      const template = buildContextMenuTemplate(contents, params)
      if (!template.length) return

      const window = BrowserWindow.fromWebContents(contents)
      Menu.buildFromTemplate(template).popup(window ? { window } : undefined)
    })
  })

  try {
    initializeDatabase({
      dbPath: path.join(app.getPath('userData'), 'kova.sqlite'),
      migrationsPath: path.join(app.getAppPath(), 'drizzle'),
    })
  } catch (error) {
    console.error('Failed to initialize database', error)
  }

  // Use pending path from open-file event if available, otherwise check argv
  const initialPath =
    pendingOpenPath ?? process.argv.find(a => a.startsWith('--initial-path='))?.replace('--initial-path=', '')
  createWindow({ initialPath })

  ipcHandle('abortTask', async taskId => {
    TaskManager.abort(taskId)
  })

  ipcHandle('openShell', async (url: string) => {
    await shell.openExternal(url)
  })

  ipcHandle('openFileLocation', async (filePath: string) => {
    shell.showItemInFolder(filePath)
    return Result.Success(undefined)
  })

  ipcHandle('runCommand', runCommand)

  ipcHandle('setAlwaysOnTop', async (alwaysOnTop: boolean, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      window.setAlwaysOnTop(alwaysOnTop)
    }
  })

  ipcHandle('getAlwaysOnTop', async (_: void, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isAlwaysOnTop() ?? false
  })

  // Store original window bounds for restoration
  const originalWindowBounds = new Map<number, Electron.Rectangle>()

  ipcHandle('setCompactWindowSize', async (_: void, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      const windowId = window.id
      // Store the current bounds before resizing
      if (!originalWindowBounds.has(windowId)) {
        originalWindowBounds.set(windowId, window.getBounds())
      }

      const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
      const newWidth = Math.floor(screenWidth / 3)
      const newHeight = Math.floor(screenHeight / 3)

      window.setBounds({
        width: newWidth,
        height: newHeight,
        x: 0,
        y: 0,
      })
    }
  })

  ipcHandle('restoreWindowSize', async (_: void, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      const windowId = window.id
      const savedBounds = originalWindowBounds.get(windowId)

      if (savedBounds) {
        window.setBounds(savedBounds)
        originalWindowBounds.delete(windowId)
      }
    }
  })

  ipcHandle('getIsCompactWindowSize', async (_: void, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    const windowId = window.id
    return originalWindowBounds.has(windowId)
  })

  ipcHandle('listExplorerItems', async () => {
    return listExplorerItems()
  })

  ipcHandle('listFolderExplorerTabs', async () => {
    return listFolderExplorerTabs()
  })

  ipcHandle('saveFolderExplorerTabs', async input => {
    return saveFolderExplorerTabs(input)
  })

  ipcHandle('createFolder', async input => {
    return createFolder(input)
  })

  ipcHandle('getFolder', async input => {
    return getFolder(input)
  })

  ipcHandle('renameFolder', async input => {
    return renameFolder(input)
  })

  ipcHandle('updateFolder', async input => {
    return updateFolder(input)
  })

  ipcHandle('deleteFolder', async input => {
    return deleteFolder(input)
  })

  ipcHandle('listOperations', async input => {
    return listOperations(input ?? undefined)
  })

  ipcHandle('undoOperation', async input => {
    return undoOperation(input)
  })

  ipcHandle('deleteOperation', async input => {
    return deleteOperation(input)
  })

  ipcHandle('undoOperations', async input => {
    return undoOperations(input)
  })

  ipcHandle('deleteOperations', async input => {
    return deleteOperations(input)
  })

  ipcHandle('createRequest', async input => {
    return createRequest(input)
  })

  ipcHandle('getRequest', async input => {
    return getRequest(input)
  })

  ipcHandle('updateRequest', async input => {
    return updateRequest(input)
  })

  ipcHandle('updateRequestResponseBodyViewPreference', async input => {
    return updateRequestResponseBodyViewPreference(input)
  })

  ipcHandle('deleteRequest', async input => {
    return deleteRequest(input)
  })

  ipcHandle('duplicateRequest', async input => {
    return duplicateRequest(input)
  })

  ipcHandle('createRequestExample', async input => {
    return createRequestExample(input)
  })

  ipcHandle('getRequestExample', async input => {
    return getRequestExample(input)
  })

  ipcHandle('updateRequestExample', async input => {
    return updateRequestExample(input)
  })

  ipcHandle('deleteRequestExample', async input => {
    return deleteRequestExample(input)
  })

  ipcHandle('moveRequestExample', async input => {
    return moveRequestExample(input)
  })

  ipcHandle('createWebSocketExample', async input => {
    return createWebSocketExample(input)
  })

  ipcHandle('getWebSocketExample', async input => {
    return getWebSocketExample(input)
  })

  ipcHandle('updateWebSocketExample', async input => {
    return updateWebSocketExample(input)
  })

  ipcHandle('deleteWebSocketExample', async input => {
    return deleteWebSocketExample(input)
  })

  ipcHandle('moveWebSocketExample', async input => {
    return moveWebSocketExample(input)
  })

  ipcHandle('listEnvironments', async () => {
    return listEnvironments()
  })

  ipcHandle('getAppSettings', async () => {
    return getAppSettings()
  })

  ipcHandle('createEnvironment', async input => {
    return createEnvironment(input)
  })

  ipcHandle('duplicateEnvironment', async input => {
    return duplicateEnvironment(input)
  })

  ipcHandle('updateEnvironment', async input => {
    return updateEnvironment(input)
  })

  ipcHandle('updateAppSettings', async input => {
    return updateAppSettings(input)
  })

  ipcHandle('deleteEnvironment', async input => {
    return deleteEnvironment(input)
  })

  ipcHandle('moveEnvironment', async input => {
    return moveEnvironment(input)
  })

  ipcHandle('moveExplorerItem', async input => {
    return moveExplorerItem(input)
  })

  ipcHandle('sendRequest', async input => {
    return sendRequest(input)
  })

  ipcHandle('cancelHttpRequest', async input => {
    return cancelHttpRequest(input)
  })

  ipcHandle('generateRequestCode', async input => {
    const requestResult = await getRequest({ id: input.requestId })
    if (!requestResult.success) {
      return requestResult
    }

    const preparedRequest = await prepareHttpRequest({
      requestId: requestResult.data.id,
      method: requestResult.data.method,
      url: requestResult.data.url,
      pathParams: requestResult.data.pathParams,
      searchParams: requestResult.data.searchParams,
      auth: requestResult.data.auth,
      preRequestScript: requestResult.data.preRequestScript,
      postRequestScript: requestResult.data.postRequestScript,
      headers: requestResult.data.headers,
      body: requestResult.data.body,
      bodyType: requestResult.data.bodyType,
      rawType: requestResult.data.rawType,
      activeEnvironmentIds: input.activeEnvironmentIds,
      saveToHistory: false,
      historyKeepLast: 0,
    })
    if (!preparedRequest.success) {
      return preparedRequest
    }

    return Result.Success({
      curl: buildCurlCommand(preparedRequest.data),
      fetch: buildFetchSnippet(preparedRequest.data),
    })
  })

  ipcHandle('connectWebSocket', async input => {
    return connectWebSocket(input)
  })

  ipcHandle('sendWebSocketMessage', async input => {
    return sendWebSocketMessage(input)
  })

  ipcHandle('disconnectWebSocket', async input => {
    return disconnectWebSocket(input)
  })

  ipcHandle('listWebSocketSavedMessages', async input => {
    return listWebSocketSavedMessages(input)
  })

  ipcHandle('createWebSocketSavedMessage', async input => {
    return createWebSocketSavedMessage(input)
  })

  ipcHandle('updateWebSocketSavedMessage', async input => {
    return updateWebSocketSavedMessage(input)
  })

  ipcHandle('deleteWebSocketSavedMessage', async input => {
    return deleteWebSocketSavedMessage(input)
  })

  ipcHandle('listRequestHistory', async input => {
    return listRequestHistory(input)
  })

  ipcHandle('deleteRequestHistoryEntry', async input => {
    return deleteRequestHistoryEntry(input)
  })

  ipcHandle('trimRequestHistory', async input => {
    return trimRequestHistory(input)
  })

  ipcHandle('pickPostmanCollectionFile', async (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Postman Collections', extensions: ['json'] }],
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePaths[0] })
  })

  ipcHandle('analyzePostmanCollection', async input => {
    return analyzePostmanCollection(input)
  })

  ipcHandle('importPostmanCollection', async input => {
    return importPostmanCollection(input)
  })

  ipcHandle('pickPostmanCollectionExportFile', async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.SaveDialogOptions = {
      filters: [{ name: 'Postman Collections', extensions: ['json'] }],
      defaultPath: input.suggestedFileName,
    }
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePath })
  })

  ipcHandle('analyzePostmanCollectionExport', async input => {
    return analyzePostmanCollectionExport(input)
  })

  ipcHandle('exportPostmanCollection', async input => {
    return exportPostmanCollection(input)
  })

  ipcHandle('pickPostmanEnvironmentFile', async (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Postman Environments', extensions: ['json'] }],
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePaths[0] })
  })

  ipcHandle('analyzePostmanEnvironment', async input => {
    return analyzePostmanEnvironment(input)
  })

  ipcHandle('importPostmanEnvironment', async input => {
    return importPostmanEnvironment(input)
  })

  ipcHandle('pickPostmanEnvironmentExportFile', async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.SaveDialogOptions = {
      filters: [{ name: 'Postman Environments', extensions: ['json'] }],
      defaultPath: input.suggestedFileName,
    }
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePath })
  })

  ipcHandle('analyzePostmanEnvironmentExport', async input => {
    return analyzePostmanEnvironmentExport(input)
  })

  ipcHandle('exportPostmanEnvironment', async input => {
    return exportPostmanEnvironment(input)
  })

  TaskManager.addListener(e => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) return

    for (const win of windows) {
      win.webContents.send('task:event', e)
    }
  })
})

function buildContextMenuTemplate(
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams
): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (params.isEditable) {
    template.push(
      { role: 'undo', enabled: params.editFlags.canUndo },
      { role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { role: 'selectAll' }
    )
  } else if (params.selectionText) {
    template.push({ role: 'copy', enabled: params.editFlags.canCopy })
  }

  if (params.mediaType === 'image') {
    if (template.length) template.push({ type: 'separator' })
    template.push(
      {
        label: 'Copy Image',
        click: () => contents.copyImageAt(params.x, params.y),
      },
      {
        label: 'Save Image As...',
        click: () => contents.downloadURL(params.srcURL),
      }
    )
  }

  if (params.linkURL) {
    if (template.length) template.push({ type: 'separator' })
    template.push(
      {
        label: 'Open Link',
        click: () => shell.openExternal(params.linkURL),
      },
      {
        label: 'Copy Link',
        click: () => clipboard.writeText(params.linkURL),
      }
    )
  }

  if (isDev()) {
    if (template.length) template.push({ type: 'separator' })
    template.push({ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) })
  }

  return template
}

// Listen for window focus events and notify renderer
app.on('browser-window-focus', (_event, window) => {
  window.webContents.send('window:focus')
})
