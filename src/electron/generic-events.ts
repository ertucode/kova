import { BrowserWindow } from 'electron'
import type { GenericEvent } from '../common/GenericEvent.js'

export function emitGenericEvent(event: GenericEvent) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('generic:event', event)
  }
}
