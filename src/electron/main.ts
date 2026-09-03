import { app, BrowserWindow, Menu, screen, shell, clipboard, dialog } from 'electron'
import path from 'path'
import os, { homedir } from 'os'
import { constants as fsConstants } from 'fs'
import fsSync from 'fs'
import { copyFile, mkdir, rename, unlink, writeFile } from 'fs/promises'
import { ipcHandle, isDev } from './util.js'
import { getPreloadPath, getUIPath } from './pathResolver.js'
import { TaskManager } from './TaskManager.js'
import { closeDatabase, initializeDatabase, verifyDatabaseConnection } from './db/index.js'
import { DEFAULT_SCRIPT_AI_SERVER_PORT } from '../common/AppSettings.js'
import type { EnvironmentRecord } from '../common/Environments.js'
import type { PreparedHttpRequest } from './http-request-runtime.js'
import type { RequestCodeGenerationMode } from '../common/RequestCodegen.js'
import { Typescript } from '../common/Typescript.js'
import { serializeWindowArguments, WindowArguments } from '../common/WindowArguments.js'
import { runCommand } from './utils/run-command.js'
import {
  getResolvedDatabaseConfig,
  getServerConfig,
} from './server-config.js'
import { GenericError } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import { createScriptMakeRequestRegistry, createScriptPromptRegistry } from './script-ui-bridges.js'
import {
  configureScriptAiBaseDirectory,
  shutdownScriptAiServer,
} from './script-ai-sdk.js'
import { configureScriptAiDiagnosticsBridge, getScriptAiDiagnostics } from './script-ai-diagnostics.js'
import { startScriptAiDiagnosticsBridge } from './script-ai-diagnostics-bridge.js'
import {
  configureScriptPackageRegistry,
} from './script-package-registry.js'
import {
  configureManagementAgentBaseDirectory,
  shutdownManagementAgentServer,
} from './management-agent.js'
import type { SaveTextToFileInput } from '../common/TextFileSave.js'

// Handle folders/files opened via "open with" or as default app
let pendingOpenPath: string | undefined
let scriptAiDiagnosticsBridge: Awaited<ReturnType<typeof startScriptAiDiagnosticsBridge>> | null = null

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

app.once('will-quit', () => {
  void scriptAiDiagnosticsBridge?.close().catch(error => {
    console.error('Failed to close Script AI diagnostics bridge', error)
  })
  void shutdownScriptAiServer()
  void shutdownManagementAgentServer()
})

type WindowArgsWithoutStatic = Omit<WindowArguments, 'homeDir' | 'asyncStorage' | 'isDev'>

const homeDir = os.homedir()
const scriptPromptRegistry = createScriptPromptRegistry()
const scriptMakeRequestRegistry = createScriptMakeRequestRegistry()
const loadCookiesDb = () => import('./db/cookies.js')
const loadAppSettingsDb = () => import('./db/app-settings.js')
const loadExplorerDb = () => import('./db/explorer.js')
const loadFolderExplorerTabsDb = () => import('./db/folder-explorer-tabs.js')
const loadFoldersDb = () => import('./db/folders.js')
const loadEnvironmentsDb = () => import('./db/environments.js')
const loadRequestHistoryDb = () => import('./db/request-history.js')
const loadFolderRunHistoryDb = () => import('./db/folder-run-history.js')
const loadRequestsDb = () => import('./db/requests.js')
const loadRequestExamplesDb = () => import('./db/request-examples.js')
const loadWebSocketExamplesDb = () => import('./db/websocket-examples.js')
const loadWebSocketSavedMessagesDb = () => import('./db/websocket-saved-messages.js')
const loadTreeItemsDb = () => import('./db/tree-items.js')
const loadOperationsDb = () => import('./db/operations.js')
const loadSharedScriptsDb = () => import('./db/shared-scripts.js')
const loadViewsDb = () => import('./db/views.js')
const loadViewCacheDb = () => import('./db/view-cache.js')
const loadScriptPackagesDb = () => import('./db/script-packages.js')
const loadTagsDb = () => import('./db/tags.js')
const loadSendRequestRuntime = () => import('./send-request.js')
const loadMcpRuntime = () => import('./mcp-runtime.js')
const loadFolderRequestRunner = () => import('./folder-request-runner.js')
const loadHttpRequestRuntime = () => import('./http-request-runtime.js')
const loadWebSocketRuntime = () => import('./websocket-runtime.js')
const loadPostmanImport = () => import('./postman-import.js')
const loadPostmanEnvironmentImport = () => import('./postman-environment-import.js')
const loadPostmanExport = () => import('./postman-export.js')
const loadPostmanEnvironmentExport = () => import('./postman-environment-export.js')
const loadOpenApiImport = () => import('./openapi-import.js')
const loadOpenApiExport = () => import('./openapi-export.js')
const loadServerConfig = () => import('./server-config.js')
const loadScriptUiBridges = () => import('./script-ui-bridges.js')
const loadScriptAiSdk = () => import('./script-ai-sdk.js')
const loadScriptPackageRegistry = () => import('./script-package-registry.js')
const loadOpenCodeModels = () => import('./opencode-models.js')
const loadSupermavenService = async () => (await import('./supermaven-service.js')).supermavenService
const loadManagementAgent = () => import('./management-agent.js')

function getDefaultDatabasePath() {
  return path.join(app.getPath('userData'), 'kova.sqlite')
}

function getMigrationsPath() {
  return path.join(app.getAppPath(), 'drizzle')
}

async function syncConfiguredDatabase() {
  const databaseConfig = await getResolvedDatabaseConfig(getDefaultDatabasePath())
  const activeDatabase = databaseConfig.items.find(item => item.name === databaseConfig.activeName)

  initializeDatabase({
    dbPath: activeDatabase?.path ?? getDefaultDatabasePath(),
    migrationsPath: getMigrationsPath(),
  })

  return databaseConfig
}

function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function moveDatabaseFile(sourcePath: string, targetPath: string) {
  const resolvedSourcePath = path.resolve(sourcePath)
  const resolvedTargetPath = path.resolve(targetPath)

  if (resolvedSourcePath === resolvedTargetPath) {
    return
  }

  await mkdir(path.dirname(resolvedTargetPath), { recursive: true })

  try {
    await rename(resolvedSourcePath, resolvedTargetPath)
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === 'EXDEV') {
      await copyFile(resolvedSourcePath, resolvedTargetPath, fsConstants.COPYFILE_EXCL)
      await unlink(resolvedSourcePath)
      return
    }

    throw error
  }
}

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

app.on('ready', async () => {
  if (isDev()) {
    fsSync.watchFile(homedir() + '/focus-electron', { interval: 50 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('Focusing Electron')
        const windows = BrowserWindow.getAllWindows()
        if (windows[0]) {
          windows[0].show()
          windows[0].focus()
        }
      }
    })
  }
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
  configureScriptPackageRegistry(path.join(app.getPath('userData'), 'shared'))
  configureScriptAiBaseDirectory(path.join(app.getPath('userData'), 'script-ai'))
  configureManagementAgentBaseDirectory(path.join(app.getPath('userData'), 'management-agent'))

  app.on('web-contents-created', (_event, contents) => {
    // if (contents.getType() === 'webview') return

    contents.on('context-menu', async (_contextEvent, params) => {
      const template = await buildContextMenuTemplate(contents, params)
      if (!template.length) return

      const window = BrowserWindow.fromWebContents(contents)
      Menu.buildFromTemplate(template).popup(window ? { window } : undefined)
    })
  })

  try {
    await syncConfiguredDatabase()
  } catch (error) {
    console.error('Failed to initialize database', error)
  }

  try {
    scriptAiDiagnosticsBridge = await startScriptAiDiagnosticsBridge({
      async getDiagnostics(input) {
        return await getScriptAiDiagnostics(input)
      },
    })
    configureScriptAiDiagnosticsBridge({
      url: scriptAiDiagnosticsBridge.url,
      token: scriptAiDiagnosticsBridge.token,
    })
  } catch (error) {
    console.error('Failed to start Script AI diagnostics bridge', error)
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

  ipcHandle('openFile', async (filePath: string) => {
    const errorMessage = await shell.openPath(filePath)
    if (errorMessage) {
      return GenericError.Message(errorMessage)
    }

    return Result.Success(undefined)
  })

  ipcHandle('openFileLocation', async (filePath: string) => {
    shell.showItemInFolder(filePath)
    return Result.Success(undefined)
  })

  ipcHandle('pickFilePath', async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      defaultPath: input.defaultPath,
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePaths[0] })
  })

  ipcHandle('saveTextToFile', async (input: SaveTextToFileInput, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.SaveDialogOptions = {
      defaultPath: input.suggestedFileName,
      filters: input.filters,
    }
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return GenericError.Message('File selection was cancelled')
    }

    await writeFile(result.filePath, input.content, 'utf8')
    return Result.Success({ filePath: result.filePath })
  })

  ipcHandle('runCommand', runCommand)

  ipcHandle('resolveScriptPrompt', async (input, event) => {
    scriptPromptRegistry.resolveResponse(input, event.sender)
  })

  ipcHandle('resolveScriptMakeRequest', async (input, event) => {
    scriptMakeRequestRegistry.resolveResponse(input, event.sender)
  })

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

  ipcHandle('listCookies', async () => {
    const { listCookies } = await loadCookiesDb()
    return listCookies()
  })

  ipcHandle('createCookie', async input => {
    const { createCookie } = await loadCookiesDb()
    return createCookie(input)
  })

  ipcHandle('updateCookie', async input => {
    const { updateCookie } = await loadCookiesDb()
    return updateCookie(input)
  })

  ipcHandle('deleteCookie', async input => {
    const { deleteCookie } = await loadCookiesDb()
    return deleteCookie(input)
  })

  ipcHandle('clearCookies', async input => {
    const { clearCookies } = await loadCookiesDb()
    return clearCookies(input ?? {})
  })

  ipcHandle('listExplorerItems', async () => {
    const { listExplorerItems } = await loadExplorerDb()
    return listExplorerItems()
  })

  ipcHandle('listFolderExplorerTabs', async () => {
    const { listFolderExplorerTabs } = await loadFolderExplorerTabsDb()
    return listFolderExplorerTabs()
  })

  ipcHandle('saveFolderExplorerTabs', async input => {
    const { saveFolderExplorerTabs } = await loadFolderExplorerTabsDb()
    return saveFolderExplorerTabs(input)
  })

  ipcHandle('updateFolderExplorerTab', async input => {
    const { updateFolderExplorerTab } = await loadFolderExplorerTabsDb()
    return updateFolderExplorerTab(input)
  })

  ipcHandle('runFolderRequests', async (input, event) => {
    const [{ runFolderRequests }, { createScriptToastBridge }] = await Promise.all([
      loadFolderRequestRunner(),
      loadScriptUiBridges(),
    ])
    return runFolderRequests(input, {
      toast: createScriptToastBridge(event.sender),
      prompt: scriptPromptRegistry.createBridge(event.sender),
      clipboard: {
        writeText: value => clipboard.writeText(value),
      },
      makeRequest: createScriptRequestBridge(event.sender),
    })
  })

  ipcHandle('cancelFolderRun', async input => {
    const { cancelFolderRun } = await loadFolderRequestRunner()
    return cancelFolderRun(input)
  })

  ipcHandle('deleteFolderRunHistory', async input => {
    const { deleteFolderRunHistory } = await loadFolderRunHistoryDb()
    return deleteFolderRunHistory(input)
  })

  ipcHandle('listFolderRunHistory', async input => {
    const { listFolderRunHistory } = await loadFolderRunHistoryDb()
    return listFolderRunHistory(input)
  })

  ipcHandle('getFolderRunHistory', async input => {
    const { getFolderRunHistory } = await loadFolderRunHistoryDb()
    return getFolderRunHistory(input)
  })

  ipcHandle('createFolder', async input => {
    const { createFolder } = await loadFoldersDb()
    return createFolder(input)
  })

  ipcHandle('getFolder', async input => {
    const { getFolder } = await loadFoldersDb()
    return getFolder(input)
  })

  ipcHandle('renameFolder', async input => {
    const { renameFolder } = await loadFoldersDb()
    return renameFolder(input)
  })

  ipcHandle('updateFolder', async input => {
    const { updateFolder } = await loadFoldersDb()
    return updateFolder(input)
  })

  ipcHandle('deleteFolder', async input => {
    const { deleteFolder } = await loadFoldersDb()
    return deleteFolder(input)
  })

  ipcHandle('listOperations', async input => {
    const { listOperations } = await loadOperationsDb()
    return listOperations(input ?? undefined)
  })

  ipcHandle('undoOperation', async input => {
    const { undoOperation } = await loadOperationsDb()
    return undoOperation(input)
  })

  ipcHandle('deleteOperation', async input => {
    const { deleteOperation } = await loadOperationsDb()
    return deleteOperation(input)
  })

  ipcHandle('undoOperations', async input => {
    const { undoOperations } = await loadOperationsDb()
    return undoOperations(input)
  })

  ipcHandle('deleteOperations', async input => {
    const { deleteOperations } = await loadOperationsDb()
    return deleteOperations(input)
  })

  ipcHandle('createRequest', async input => {
    const { createRequest } = await loadRequestsDb()
    return createRequest(input)
  })

  ipcHandle('getRequest', async input => {
    const { getRequest } = await loadRequestsDb()
    return getRequest(input)
  })

  ipcHandle('updateRequest', async input => {
    const { updateRequest } = await loadRequestsDb()
    return updateRequest(input)
  })

  ipcHandle('updateRequestResponseBodyViewPreference', async input => {
    const { updateRequestResponseBodyViewPreference } = await loadRequestsDb()
    return updateRequestResponseBodyViewPreference(input)
  })

  ipcHandle('deleteRequest', async input => {
    const { deleteRequest } = await loadRequestsDb()
    return deleteRequest(input)
  })

  ipcHandle('duplicateRequest', async input => {
    const { duplicateRequest } = await loadRequestsDb()
    return duplicateRequest(input)
  })

  ipcHandle('createRequestExample', async input => {
    const { createRequestExample } = await loadRequestExamplesDb()
    return createRequestExample(input)
  })

  ipcHandle('getRequestExample', async input => {
    const { getRequestExample } = await loadRequestExamplesDb()
    return getRequestExample(input)
  })

  ipcHandle('updateRequestExample', async input => {
    const { updateRequestExample } = await loadRequestExamplesDb()
    return updateRequestExample(input)
  })

  ipcHandle('deleteRequestExample', async input => {
    const { deleteRequestExample } = await loadRequestExamplesDb()
    return deleteRequestExample(input)
  })

  ipcHandle('moveRequestExample', async input => {
    const { moveRequestExample } = await loadRequestExamplesDb()
    return moveRequestExample(input)
  })

  ipcHandle('createWebSocketExample', async input => {
    const { createWebSocketExample } = await loadWebSocketExamplesDb()
    return createWebSocketExample(input)
  })

  ipcHandle('getWebSocketExample', async input => {
    const { getWebSocketExample } = await loadWebSocketExamplesDb()
    return getWebSocketExample(input)
  })

  ipcHandle('updateWebSocketExample', async input => {
    const { updateWebSocketExample } = await loadWebSocketExamplesDb()
    return updateWebSocketExample(input)
  })

  ipcHandle('deleteWebSocketExample', async input => {
    const { deleteWebSocketExample } = await loadWebSocketExamplesDb()
    return deleteWebSocketExample(input)
  })

  ipcHandle('moveWebSocketExample', async input => {
    const { moveWebSocketExample } = await loadWebSocketExamplesDb()
    return moveWebSocketExample(input)
  })

  ipcHandle('listEnvironments', async () => {
    const { listEnvironments } = await loadEnvironmentsDb()
    return listEnvironments()
  })

  ipcHandle('getAppSettings', async () => {
    const { getAppSettings } = await loadAppSettingsDb()
    return getAppSettings()
  })

  ipcHandle('getSupermavenStatus', async () => {
    const supermavenService = await loadSupermavenService()
    return await supermavenService.getStatus()
  })

  ipcHandle('createEnvironment', async input => {
    const { createEnvironment } = await loadEnvironmentsDb()
    return createEnvironment(input)
  })

  ipcHandle('duplicateEnvironment', async input => {
    const { duplicateEnvironment } = await loadEnvironmentsDb()
    return duplicateEnvironment(input)
  })

  ipcHandle('updateEnvironment', async input => {
    const { updateEnvironment } = await loadEnvironmentsDb()
    return updateEnvironment(input)
  })

  ipcHandle('updateAppSettings', async input => {
    const [{ getAppSettings, updateAppSettings }, supermavenService] = await Promise.all([
      loadAppSettingsDb(),
      loadSupermavenService(),
    ])
    const previousSettings = await getAppSettings()
    const result = await updateAppSettings(input)
    if (!result.success) {
      return result
    }

    const previousScriptAiServerPort = previousSettings.scriptAiServerPort ?? DEFAULT_SCRIPT_AI_SERVER_PORT
    const nextScriptAiServerPort = result.data.scriptAiServerPort ?? DEFAULT_SCRIPT_AI_SERVER_PORT

    if (previousScriptAiServerPort !== nextScriptAiServerPort) {
      await shutdownScriptAiServer()
      await shutdownManagementAgentServer()
    }

    if (previousSettings.supermavenEnabled !== result.data.supermavenEnabled) {
      supermavenService.setEnabled(result.data.supermavenEnabled)
    }

    return result
  })

  ipcHandle('requestSupermavenInlineSuggestion', async input => {
    const supermavenService = await loadSupermavenService()
    return await supermavenService.requestInlineSuggestion(input)
  })

  ipcHandle('deleteEnvironment', async input => {
    const { deleteEnvironment } = await loadEnvironmentsDb()
    return deleteEnvironment(input)
  })

  ipcHandle('moveEnvironment', async input => {
    const { moveEnvironment } = await loadEnvironmentsDb()
    return moveEnvironment(input)
  })

  ipcHandle('listSharedScripts', async input => {
    const { listSharedScripts } = await loadSharedScriptsDb()
    return listSharedScripts(input)
  })

  ipcHandle('createSharedScript', async input => {
    const { createSharedScript } = await loadSharedScriptsDb()
    return createSharedScript(input)
  })

  ipcHandle('updateSharedScript', async input => {
    const { updateSharedScript } = await loadSharedScriptsDb()
    return updateSharedScript(input)
  })

  ipcHandle('deleteSharedScript', async input => {
    const { deleteSharedScript } = await loadSharedScriptsDb()
    return deleteSharedScript(input)
  })

  ipcHandle('moveSharedScript', async input => {
    const { moveSharedScript } = await loadSharedScriptsDb()
    return moveSharedScript(input)
  })

  ipcHandle('listVisibleSharedScripts', async input => {
    const { listVisibleSharedScripts } = await loadSharedScriptsDb()
    return listVisibleSharedScripts({ folderId: input.folderId, onlyActive: true })
  })

  ipcHandle('listViews', async () => {
    const { listViews } = await loadViewsDb()
    return listViews()
  })

  ipcHandle('createView', async input => {
    const { createView } = await loadViewsDb()
    return createView(input)
  })

  ipcHandle('updateView', async input => {
    const { updateView } = await loadViewsDb()
    return updateView(input)
  })

  ipcHandle('deleteView', async input => {
    const { deleteView } = await loadViewsDb()
    return deleteView(input)
  })

  ipcHandle('moveView', async input => {
    const { moveView } = await loadViewsDb()
    return moveView(input)
  })

  ipcHandle('listViewCacheEntries', async input => {
    const { listViewCacheEntries } = await loadViewCacheDb()
    return listViewCacheEntries(input)
  })

  ipcHandle('getViewCacheEntry', async input => {
    const { getViewCacheEntry } = await loadViewCacheDb()
    return getViewCacheEntry(input)
  })

  ipcHandle('setViewCacheEntry', async input => {
    const { setViewCacheEntry } = await loadViewCacheDb()
    return setViewCacheEntry(input)
  })

  ipcHandle('deleteViewCacheEntry', async input => {
    const { deleteViewCacheEntry } = await loadViewCacheDb()
    return deleteViewCacheEntry(input)
  })

  ipcHandle('listScriptPackages', async () => {
    const [{ listScriptPackages, toScriptPackageCacheKey }, { getScriptPackageRegistryEntry }] = await Promise.all([
      loadScriptPackagesDb(),
      loadScriptPackageRegistry(),
    ])
    const records = await listScriptPackages()
    const items = await Promise.all(
      records.map(async record => {
        const cacheKey = toScriptPackageCacheKey(record)
        const registryEntry = await getScriptPackageRegistryEntry(record)
        return {
          ...record,
          cacheKey,
          downloadStatus: registryEntry?.status ?? 'not-downloaded',
          cacheDirectory: registryEntry?.cacheDirectory ?? null,
          errorMessage: registryEntry?.errorMessage ?? null,
          downloadedAt: registryEntry?.downloadedAt ?? null,
        }
      })
    )

    return items
  })

  ipcHandle('createScriptPackage', async input => {
    const { createScriptPackage } = await loadScriptPackagesDb()
    return createScriptPackage(input)
  })

  ipcHandle('updateScriptPackage', async input => {
    const { updateScriptPackage } = await loadScriptPackagesDb()
    return updateScriptPackage(input)
  })

  ipcHandle('deleteScriptPackage', async input => {
    const { deleteScriptPackage } = await loadScriptPackagesDb()
    return deleteScriptPackage(input)
  })

  ipcHandle('suggestScriptPackageVersion', async input => {
    const { suggestScriptPackageVersion } = await loadScriptPackageRegistry()
    return suggestScriptPackageVersion(input)
  })

  ipcHandle('suggestTypesScriptPackage', async input => {
    const { suggestTypesScriptPackage } = await loadScriptPackageRegistry()
    return suggestTypesScriptPackage(input)
  })

  ipcHandle('downloadScriptPackage', async input => {
    const { downloadScriptPackage } = await loadScriptPackageRegistry()
    return downloadScriptPackage(input)
  })

  ipcHandle('deleteDownloadedScriptPackage', async input => {
    const { deleteDownloadedScriptPackage } = await loadScriptPackageRegistry()
    return deleteDownloadedScriptPackage(input)
  })

  ipcHandle('getScriptPackageArtifacts', async () => {
    const [{ listScriptPackages }, { getScriptPackageArtifact }] = await Promise.all([
      loadScriptPackagesDb(),
      loadScriptPackageRegistry(),
    ])
    const records = await listScriptPackages()
    const artifacts = await Promise.all(records.map(record => getScriptPackageArtifact(record)))
    return artifacts.filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
  })

  ipcHandle('listTags', async () => {
    const { listTags } = await loadTagsDb()
    return listTags()
  })

  ipcHandle('listTagAssignments', async () => {
    const { listTagAssignments } = await loadTagsDb()
    return listTagAssignments()
  })

  ipcHandle('createTag', async input => {
    const { createTag } = await loadTagsDb()
    return createTag(input)
  })

  ipcHandle('updateTag', async input => {
    const { updateTag } = await loadTagsDb()
    return updateTag(input)
  })

  ipcHandle('deleteTag', async input => {
    const { deleteTag } = await loadTagsDb()
    return deleteTag(input)
  })

  ipcHandle('moveTag', async input => {
    const { moveTag } = await loadTagsDb()
    return moveTag(input)
  })

  ipcHandle('replaceItemTags', async input => {
    const { replaceItemTags } = await loadTagsDb()
    return replaceItemTags(input)
  })

  ipcHandle('replaceTagItems', async input => {
    const { replaceTagItems } = await loadTagsDb()
    return replaceTagItems(input)
  })

  ipcHandle('moveExplorerItem', async input => {
    const { moveExplorerItem } = await loadTreeItemsDb()
    return moveExplorerItem(input)
  })

  ipcHandle('sendRequest', async (input, event) => {
    const [{ sendRequest }, { createScriptToastBridge }] = await Promise.all([
      loadSendRequestRuntime(),
      loadScriptUiBridges(),
    ])
    const makeRequestBridge = createScriptRequestBridge(event.sender)
    return sendRequest(input, {
      toast: createScriptToastBridge(event.sender),
      prompt: scriptPromptRegistry.createBridge(event.sender),
      clipboard: {
        writeText: value => clipboard.writeText(value),
      },
      makeRequest: makeRequestBridge,
    })
  })

  ipcHandle('fetchGraphqlSchema', async (input, event) => {
    const [{ fetchGraphqlSchema }, { createScriptToastBridge }] = await Promise.all([
      loadSendRequestRuntime(),
      loadScriptUiBridges(),
    ])
    const makeRequestBridge = createScriptRequestBridge(event.sender)
    return fetchGraphqlSchema(input, {
      toast: createScriptToastBridge(event.sender),
      prompt: scriptPromptRegistry.createBridge(event.sender),
      clipboard: {
        writeText: value => clipboard.writeText(value),
      },
      makeRequest: makeRequestBridge,
    })
  })

  ipcHandle('fetchMcpIntrospection', async input => {
    const { fetchMcpIntrospection } = await loadMcpRuntime()
    return fetchMcpIntrospection(input)
  })

  ipcHandle('invokeMcpRequest', async input => {
    const { invokeMcpRequest } = await loadMcpRuntime()
    return invokeMcpRequest(input)
  })

  ipcHandle('cancelHttpRequest', async input => {
    const { cancelHttpRequest } = await loadSendRequestRuntime()
    return cancelHttpRequest(input)
  })

  ipcHandle('generateRequestCode', async input => {
    const [{ getRequest }, { buildCurlCommand, buildFetchSnippet, maskEnvironmentValuesForCodegen, maskRequestAuthForCodegen, prepareHttpRequest }] =
      await Promise.all([loadRequestsDb(), loadHttpRequestRuntime()])
    const requestResult = await getRequest({ id: input.requestId })
    if (!requestResult.success) {
      return requestResult
    }

    const beforePrepareHttpRequest =
      input.mode === 'mask-variables'
        ? ({ environments, folderEnvironments }: { environments: EnvironmentRecord[]; folderEnvironments: EnvironmentRecord[] }) => ({
            environments: maskEnvironmentValuesForCodegen(environments),
            folderEnvironments: maskEnvironmentValuesForCodegen(folderEnvironments),
          })
        : undefined

    const preparedRequest = await prepareHttpRequest({
      requestId: requestResult.data.id,
      method: requestResult.data.method,
      url: requestResult.data.url,
      pathParams: requestResult.data.pathParams,
      searchParams: requestResult.data.searchParams,
      auth: requestResult.data.auth,
      preRequestScript: requestResult.data.preRequestScript,
      postRequestScript: requestResult.data.postRequestScript,
      testScript: requestResult.data.testScript,
      headers: requestResult.data.headers,
      body: requestResult.data.body,
      bodyType: requestResult.data.bodyType,
      rawType: requestResult.data.rawType,
      graphqlQuery: requestResult.data.graphqlQuery,
      graphqlVariables: requestResult.data.graphqlVariables,
      tlsVerificationMode: requestResult.data.tlsVerificationMode,
      activeEnvironmentIds: input.activeEnvironmentIds,
      saveToHistory: false,
      historyKeepLast: 0,
      requestMetadata: {
        sourceRuntime: 'generate-request-code',
        isRetry: false,
        retryCount: 0,
      },
    }, { beforePrepareHttpRequest })
    if (!preparedRequest.success) {
      return preparedRequest
    }

    const codegenRequest = toRequestCodeGenerationInput(preparedRequest.data, input.mode, maskRequestAuthForCodegen)

    return Result.Success({
      curl: buildCurlCommand(codegenRequest),
      fetch: await buildFetchSnippet(codegenRequest),
    })
  })

  ipcHandle('loadScriptAiWorkspace', async input => {
    const { loadScriptAiWorkspace } = await loadScriptAiSdk()
    return loadScriptAiWorkspace(input)
  })

  ipcHandle('createScriptAiSession', async input => {
    const { createScriptAiSession } = await loadScriptAiSdk()
    return createScriptAiSession(input)
  })

  ipcHandle('sendScriptAiMessage', async input => {
    const { sendScriptAiMessage } = await loadScriptAiSdk()
    return sendScriptAiMessage(input)
  })

  ipcHandle('syncScriptAiWorkspace', async input => {
    const { syncScriptAiWorkspace } = await loadScriptAiSdk()
    return syncScriptAiWorkspace(input)
  })

  ipcHandle('applyScriptAiWorkspace', async input => {
    const { applyScriptAiWorkspace } = await loadScriptAiSdk()
    return applyScriptAiWorkspace(input)
  })

  ipcHandle('abortScriptAiSession', async input => {
    const { abortScriptAiSession } = await loadScriptAiSdk()
    return abortScriptAiSession(input)
  })

  ipcHandle('loadScriptAiMessagePatchDiff', async input => {
    const { loadScriptAiMessagePatchDiff } = await loadScriptAiSdk()
    return loadScriptAiMessagePatchDiff(input)
  })

  ipcHandle('loadManagementAgentWorkspace', async input => {
    const { loadManagementAgentWorkspace } = await loadManagementAgent()
    return loadManagementAgentWorkspace(input)
  })

  ipcHandle('createManagementAgentSession', async input => {
    const { createManagementAgentSession } = await loadManagementAgent()
    return createManagementAgentSession(input)
  })

  ipcHandle('sendManagementAgentMessage', async input => {
    const { sendManagementAgentMessage } = await loadManagementAgent()
    return sendManagementAgentMessage(input)
  })

  ipcHandle('abortManagementAgentSession', async input => {
    const { abortManagementAgentSession } = await loadManagementAgent()
    return abortManagementAgentSession(input)
  })

  ipcHandle('applyManagementAgentPlan', async input => {
    const { applyManagementAgentPlan } = await loadManagementAgent()
    return applyManagementAgentPlan(input)
  })

  ipcHandle('listOpenCodeModels', async () => {
    const { listOpenCodeModels } = await loadOpenCodeModels()
    return listOpenCodeModels()
  })

  ipcHandle('connectWebSocket', async (input, event) => {
    const [{ connectWebSocket }, { createScriptToastBridge }] = await Promise.all([
      loadWebSocketRuntime(),
      loadScriptUiBridges(),
    ])
    const makeRequestBridge = createScriptRequestBridge(event.sender)
    return connectWebSocket(input, {
      toast: createScriptToastBridge(event.sender),
      prompt: scriptPromptRegistry.createBridge(event.sender),
      clipboard: {
        writeText: value => clipboard.writeText(value),
      },
      makeRequest: makeRequestBridge,
    })
  })

  ipcHandle('sendWebSocketMessage', async input => {
    const { sendWebSocketMessage } = await loadWebSocketRuntime()
    return sendWebSocketMessage(input)
  })

  ipcHandle('disconnectWebSocket', async input => {
    const { disconnectWebSocket } = await loadWebSocketRuntime()
    return disconnectWebSocket(input)
  })

  ipcHandle('listWebSocketSavedMessages', async input => {
    const { listWebSocketSavedMessages } = await loadWebSocketSavedMessagesDb()
    return listWebSocketSavedMessages(input)
  })

  ipcHandle('createWebSocketSavedMessage', async input => {
    const { createWebSocketSavedMessage } = await loadWebSocketSavedMessagesDb()
    return createWebSocketSavedMessage(input)
  })

  ipcHandle('updateWebSocketSavedMessage', async input => {
    const { updateWebSocketSavedMessage } = await loadWebSocketSavedMessagesDb()
    return updateWebSocketSavedMessage(input)
  })

  ipcHandle('deleteWebSocketSavedMessage', async input => {
    const { deleteWebSocketSavedMessage } = await loadWebSocketSavedMessagesDb()
    return deleteWebSocketSavedMessage(input)
  })

  ipcHandle('listRequestHistory', async input => {
    const { listRequestHistory } = await loadRequestHistoryDb()
    return listRequestHistory(input)
  })

  ipcHandle('getRequestHistoryCount', async input => {
    const { getRequestHistoryCount } = await loadRequestHistoryDb()
    return getRequestHistoryCount(input)
  })

  ipcHandle('listRecentHttpRequestUsage', async () => {
    const { listRecentHttpRequestUsage } = await loadRequestHistoryDb()
    return listRecentHttpRequestUsage()
  })

  ipcHandle('deleteRequestHistoryEntry', async input => {
    const { deleteRequestHistoryEntry } = await loadRequestHistoryDb()
    return deleteRequestHistoryEntry(input)
  })

  ipcHandle('trimRequestHistory', async input => {
    const { trimRequestHistory } = await loadRequestHistoryDb()
    return trimRequestHistory(input)
  })

  ipcHandle('getDatabaseConfigState', async () => {
    return syncConfiguredDatabase()
  })

  ipcHandle('pickDatabaseFile', async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.SaveDialogOptions = {
      filters: [{ name: 'SQLite Databases', extensions: ['sqlite', 'db', 'sqlite3'] }],
      defaultPath: input?.suggestedPath,
    }
    const result = window
      ? await dialog.showSaveDialog(window, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions)

    if (result.canceled || !result.filePath) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePath })
  })

  ipcHandle('upsertDatabaseConfig', async input => {
    const { upsertCustomDatabaseConfig } = await loadServerConfig()
    try {
      const databaseConfig = await getResolvedDatabaseConfig(getDefaultDatabasePath())
      const existingDatabase = input.previousName
        ? databaseConfig.items.find(item => item.name === input.previousName)
        : null
      const shouldReload = !!existingDatabase && databaseConfig.activeName === input.previousName
      const sourceDatabaseName = input.basedOnName?.trim()
      const sourceFilePath = input.sourceFilePath?.trim()

      if (!input.previousName && sourceDatabaseName && sourceFilePath) {
        return GenericError.Message('Choose either an existing database or a database file as the source')
      }

      if (!input.previousName && sourceDatabaseName) {
        const sourceDatabase = databaseConfig.items.find(item => item.name === sourceDatabaseName)
        if (!sourceDatabase) {
          return GenericError.Message(`Database ${sourceDatabaseName} does not exist`)
        }

        const targetPath = path.resolve(input.path)
        const sourcePath = path.resolve(sourceDatabase.path)
        if (targetPath === sourcePath) {
          return GenericError.Message('The new database path must be different from the source database path')
        }

        await mkdir(path.dirname(targetPath), { recursive: true })
        await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL)
      } else if (!input.previousName && sourceFilePath) {
        const targetPath = path.resolve(input.path)
        const resolvedSourceFilePath = path.resolve(sourceFilePath)

        if (!fsSync.existsSync(resolvedSourceFilePath)) {
          return GenericError.Message(`Database file ${sourceFilePath} does not exist`)
        }

        if (targetPath === resolvedSourceFilePath) {
          return GenericError.Message('The new database path must be different from the source database path')
        }

        await mkdir(path.dirname(targetPath), { recursive: true })
        await copyFile(resolvedSourceFilePath, targetPath, fsConstants.COPYFILE_EXCL)
      }

      if (existingDatabase && path.resolve(existingDatabase.path) !== path.resolve(input.path)) {
        if (shouldReload) {
          closeDatabase()
        }

        await moveDatabaseFile(existingDatabase.path, input.path)
      }

      if (shouldReload) {
        verifyDatabaseConnection({
          dbPath: input.path,
          migrationsPath: getMigrationsPath(),
        })
      }

      await upsertCustomDatabaseConfig(input)
      return Result.Success(await syncConfiguredDatabase())
    } catch (error) {
      if (isNodeErrorWithCode(error) && error.code === 'EEXIST') {
        return GenericError.Message(
          'The target database file already exists. Choose another path or remove the existing file first.'
        )
      }

      return GenericError.Unknown(error)
    }
  })

  ipcHandle('deleteDatabaseConfig', async input => {
    const { deleteCustomDatabaseConfig } = await loadServerConfig()
    await deleteCustomDatabaseConfig(input.name)
    return Result.Success(await syncConfiguredDatabase())
  })

  ipcHandle('setActiveDatabaseConfig', async input => {
    const { setActiveDatabaseConfig } = await loadServerConfig()
    const databaseConfig = await getResolvedDatabaseConfig(getDefaultDatabasePath())
    const nextDatabase = databaseConfig.items.find(item => item.name === input.name)
    if (!nextDatabase) {
      throw new Error(`Database ${input.name} does not exist`)
    }

    verifyDatabaseConnection({
      dbPath: nextDatabase.path,
      migrationsPath: getMigrationsPath(),
    })

    await setActiveDatabaseConfig(input.name)
    return Result.Success(await syncConfiguredDatabase())
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
    const { analyzePostmanCollection } = await loadPostmanImport()
    return analyzePostmanCollection(input)
  })

  ipcHandle('importPostmanCollection', async input => {
    const { importPostmanCollection } = await loadPostmanImport()
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
    const { analyzePostmanCollectionExport } = await loadPostmanExport()
    return analyzePostmanCollectionExport(input)
  })

  ipcHandle('exportPostmanCollection', async input => {
    const { exportPostmanCollection } = await loadPostmanExport()
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
    const { analyzePostmanEnvironment } = await loadPostmanEnvironmentImport()
    return analyzePostmanEnvironment(input)
  })

  ipcHandle('importPostmanEnvironment', async input => {
    const { importPostmanEnvironment } = await loadPostmanEnvironmentImport()
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
    const { analyzePostmanEnvironmentExport } = await loadPostmanEnvironmentExport()
    return analyzePostmanEnvironmentExport(input)
  })

  ipcHandle('exportPostmanEnvironment', async input => {
    const { exportPostmanEnvironment } = await loadPostmanEnvironmentExport()
    return exportPostmanEnvironment(input)
  })

  ipcHandle('pickOpenApiSpecFile', async (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'OpenAPI Specs', extensions: ['json', 'yaml', 'yml'] }],
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return GenericError.Message('File selection was cancelled')
    }

    return Result.Success({ filePath: result.filePaths[0] })
  })

  ipcHandle('analyzeOpenApiSpec', async input => {
    const { analyzeOpenApiSpec } = await loadOpenApiImport()
    return analyzeOpenApiSpec(input)
  })

  ipcHandle('importOpenApiSpec', async input => {
    const { importOpenApiSpec } = await loadOpenApiImport()
    return importOpenApiSpec(input)
  })

  ipcHandle('pickOpenApiSpecExportFile', async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const dialogOptions: Electron.SaveDialogOptions = {
      filters: [{ name: 'OpenAPI Specs', extensions: ['json'] }],
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

  ipcHandle('analyzeOpenApiSpecExport', async input => {
    const { analyzeOpenApiSpecExport } = await loadOpenApiExport()
    return analyzeOpenApiSpecExport(input)
  })

  ipcHandle('exportOpenApiSpec', async input => {
    const { exportOpenApiSpec } = await loadOpenApiExport()
    return exportOpenApiSpec(input)
  })

  TaskManager.addListener(e => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) return

    for (const win of windows) {
      win.webContents.send('task:event', e)
    }
  })
})

async function buildContextMenuTemplate(
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams
): Promise<Electron.MenuItemConstructorOptions[]> {
  const template: Electron.MenuItemConstructorOptions[] = []
  const searchParamContextTarget = params.isEditable ? await getSearchParamContextTarget(contents, params) : null

  if (searchParamContextTarget) {
    template.push({
      label: 'Decode Value',
      click: () => {
        contents.send('generic:event', {
          type: 'fix-request-search-param-value',
          rowId: searchParamContextTarget.rowId,
        })
      },
    })
  }

  if (params.isEditable) {
    if (template.length) {
      template.push({ type: 'separator' })
    }

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

async function getSearchParamContextTarget(contents: Electron.WebContents, params: Electron.ContextMenuParams) {
  try {
    return await contents.executeJavaScript(
      `(() => {
        const target = document.elementFromPoint(${JSON.stringify(params.x)}, ${JSON.stringify(params.y)})
        if (!(target instanceof HTMLElement)) {
          return null
        }

        const searchParamsScope = target.closest('[data-context-scope="request-search-params"]')
        if (!(searchParamsScope instanceof HTMLElement)) {
          return null
        }

        const valueField = target.closest('[data-key-value-field="value"][data-key-value-row-id][data-key-value-current-value]')
        if (!(valueField instanceof HTMLElement)) {
          return null
        }

        const rowId = valueField.dataset.keyValueRowId
        const value = valueField.dataset.keyValueCurrentValue
        if (!rowId || value === undefined) {
          return null
        }

        try {
          const decodedValue = decodeURIComponent(value.replace(/\\+/g, ' '))
          if (decodedValue === value) {
            return null
          }

          return { rowId }
        } catch {
          return null
        }
      })()`,
      true
    )
  } catch {
    return null
  }
}

function toRequestCodeGenerationInput(
  preparedRequest: PreparedHttpRequest,
  mode: RequestCodeGenerationMode,
  maskRequestAuthForCodegen: typeof import('./http-request-runtime.js').maskRequestAuthForCodegen
) {
  switch (mode) {
    case 'resolved':
      return preparedRequest
    case 'mask-auth':
      return maskRequestAuthForCodegen(preparedRequest)
    case 'mask-variables':
      return preparedRequest
    default:
      return Typescript.assertUnreachable(mode)
  }
}

function createScriptRequestBridge(webContents: Electron.WebContents) {
  const makeRequestBridge = scriptMakeRequestRegistry.createBridge(webContents)

  return {
    navigateAndCallRequest: async (path: string[]) => {
      const { findHttpRequestByPath } = await loadExplorerDb()
      const request = await findHttpRequestByPath(path)
      if (!request) {
        throw new Error(`Request path was not found: ${path.join(' / ')}`)
      }

      return makeRequestBridge.navigateAndCallRequest(request.id, path)
    },
    callRequest: async (path: string[], overrides?: Parameters<typeof makeRequestBridge.callRequest>[2]) => {
      const { findHttpRequestByPath } = await loadExplorerDb()
      const request = await findHttpRequestByPath(path)
      if (!request) {
        throw new Error(`Request path was not found: ${path.join(' / ')}`)
      }

      return makeRequestBridge.callRequest(request.id, path, overrides)
    },
  }
}

// Listen for window focus events and notify renderer
app.on('browser-window-focus', (_event, window) => {
  window.webContents.send('window:focus')
})
