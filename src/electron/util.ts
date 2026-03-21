import { ipcMain } from 'electron'
import { getParallelHtmlPath, getUIPath } from './pathResolver.js'
import { pathToFileURL } from 'url'
import { EventResponseMapping, EventRequest } from '../common/Contracts.js'

export function isDev() {
  return process.env.NODE_ENV === 'development'
}

export function ipcHandle<Key extends keyof EventResponseMapping>(
  key: Key,
  handler: (
    request: EventRequest<Key>,
    event: Electron.IpcMainInvokeEvent
  ) => EventResponseMapping[Key] | Promise<EventResponseMapping[Key]>
) {
  ipcMain.handle(key, async (event, request) => {
    console.log('ipcHandle', key, request)
    event.senderFrame && validateEventFrame(event.senderFrame)

    const start = performance.now()

    try {
      return await handler(request, event)
    } finally {
      console.log(`ipcHandle ${String(key)} took ${(performance.now() - start).toFixed(1)}ms`)
    }
  })
}

export function ipcWebContentsSend<Key extends keyof EventResponseMapping>(
  key: Key,
  webContents: Electron.WebContents,
  payload: EventResponseMapping[Key]
) {
  webContents.send(key, payload)
}

const uiPath = pathToFileURL(getUIPath()).toString()
const parallelHtmlPath = pathToFileURL(getParallelHtmlPath()).toString()
export function validateEventFrame(frame: Electron.WebFrameMain) {
  if (isDev() && new URL(frame.url).host === 'localhost:5123') {
    return
  }

  if (frame.url === uiPath) return
  if (frame.url.split('?')[0] === parallelHtmlPath) return
  throw new Error('Malicious attempt to send IPC messages to the UI. This is a security risk.')
}
