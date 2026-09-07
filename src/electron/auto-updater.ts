import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { AppUpdateCheckResult } from '../common/AppUpdate.js'

const { autoUpdater } = electronUpdater

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
const INITIAL_UPDATE_CHECK_DELAY_MS = 10 * 1000
let declinedVersion: string | null = null

export function startAutoUpdater(parentWindow: BrowserWindow) {
  if (process.platform !== 'win32' || !app.isPackaged) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  let updatePromptOpen = false

  autoUpdater.on('error', error => {
    console.error('Auto-update failed', error)
  })

  autoUpdater.on('update-available', info => {
    if (updatePromptOpen || declinedVersion === info.version) {
      return
    }

    updatePromptOpen = true
    void promptToDownload(parentWindow, info)
      .then(shouldDownload => {
        if (!shouldDownload) {
          declinedVersion = info.version
          return
        }

        return autoUpdater.downloadUpdate()
      })
      .catch(error => {
        console.error('Failed to start update download', error)
      })
      .finally(() => {
        updatePromptOpen = false
      })
  })

  autoUpdater.on('update-downloaded', info => {
    void promptToInstall(parentWindow, info).catch(error => {
      console.error('Failed to show update installation prompt', error)
    })
  })

  const checkForUpdates = () => {
    void autoUpdater.checkForUpdates().catch(error => {
      console.error('Failed to check for updates', error)
    })
  }

  const initialCheckTimer = setTimeout(checkForUpdates, INITIAL_UPDATE_CHECK_DELAY_MS)
  initialCheckTimer.unref()

  const updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
  updateCheckTimer.unref()
}

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (process.platform !== 'win32' || !app.isPackaged) {
    return { status: 'unsupported', currentVersion }
  }

  declinedVersion = null
  const result = await autoUpdater.checkForUpdates()
  if (!result || !result.isUpdateAvailable) {
    return { status: 'up-to-date', currentVersion }
  }

  return {
    status: 'update-available',
    currentVersion,
    availableVersion: result.updateInfo.version,
  }
}

async function promptToDownload(parentWindow: BrowserWindow, info: UpdateInfo) {
  const result = await showMessageBox(parentWindow, {
    type: 'info',
    title: 'Kova update available',
    message: `Kova ${info.version} is available`,
    detail: 'Would you like to download it now?',
    buttons: ['Download update', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  return result.response === 0
}

async function promptToInstall(parentWindow: BrowserWindow, info: UpdateInfo) {
  const result = await showMessageBox(parentWindow, {
    type: 'info',
    title: 'Kova update ready',
    message: `Kova ${info.version} is ready to install`,
    detail: 'Restart Kova now to finish installing the update, or install it when Kova closes.',
    buttons: ['Restart and install', 'Install when Kova closes'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (result.response === 0) {
    autoUpdater.quitAndInstall()
  }
}

function showMessageBox(parentWindow: BrowserWindow, options: Electron.MessageBoxOptions) {
  if (!parentWindow.isDestroyed()) {
    return dialog.showMessageBox(parentWindow, options)
  }

  return dialog.showMessageBox(options)
}
