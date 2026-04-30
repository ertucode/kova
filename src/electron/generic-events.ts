import { BrowserWindow } from 'electron'
import type { GenericEvent } from '../common/GenericEvent.js'

export function emitGenericEvent(event: GenericEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    emitGenericEventTo(window.webContents, event)
  }
}

export function emitGenericEventTo(webContents: Electron.WebContents, event: GenericEvent) {
  webContents.send('generic:event', event)
}
