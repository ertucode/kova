import { app, BrowserWindow, Menu, screen, shell, clipboard } from 'electron'
import path from 'path'
import os from 'os'
import { ipcHandle, isDev } from './util.js'
import { getPreloadPath, getUIPath } from './pathResolver.js'
import { xlsxWorkerPool } from './utils/xlsx-worker-pool.js'
import { TaskManager } from './TaskManager.js'
import { initializeDatabase } from './db/index.js'
import { listExplorerItems } from './db/explorer.js'
import { createFolder, deleteFolder, getFolder, renameFolder, updateFolder } from './db/folders.js'
import { createEnvironment, deleteEnvironment, listEnvironments, updateEnvironment } from './db/environments.js'
import { deleteRequestHistoryEntry, listRequestHistory, trimRequestHistory } from './db/request-history.js'
import { createRequest, deleteRequest, getRequest, updateRequest } from './db/requests.js'
import { moveExplorerItem } from './db/tree-items.js'
import { sendRequest } from './send-request.js'
import { serializeWindowArguments, WindowArguments } from '../common/WindowArguments.js'
import { runCommand } from './utils/run-command.js'
import { getServerConfig } from './server-config.js'

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
    if (contents.getType() !== 'webview') return

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

  ipcHandle('createRequest', async input => {
    return createRequest(input)
  })

  ipcHandle('getRequest', async input => {
    return getRequest(input)
  })

  ipcHandle('updateRequest', async input => {
    return updateRequest(input)
  })

  ipcHandle('deleteRequest', async input => {
    return deleteRequest(input)
  })

  ipcHandle('listEnvironments', async () => {
    return listEnvironments()
  })

  ipcHandle('createEnvironment', async input => {
    return createEnvironment(input)
  })

  ipcHandle('updateEnvironment', async input => {
    return updateEnvironment(input)
  })

  ipcHandle('deleteEnvironment', async input => {
    return deleteEnvironment(input)
  })

  ipcHandle('moveExplorerItem', async input => {
    return moveExplorerItem(input)
  })

  ipcHandle('sendRequest', async input => {
    return sendRequest(input)
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

// Clean up worker pool when app is quitting
app.on('before-quit', async () => {
  await xlsxWorkerPool.terminate()
})
