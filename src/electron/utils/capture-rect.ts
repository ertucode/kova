import { BrowserWindow } from 'electron'

export async function captureRect(rect: Electron.Rectangle, event: Electron.IpcMainInvokeEvent) {
  const win = BrowserWindow.fromWebContents(event.sender)!
  return await win.capturePage(rect)
}
