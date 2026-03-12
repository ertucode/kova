import { app } from 'electron'
import path from 'path'
import { isDev } from './util.js'

export function getPreloadPath() {
  return path.join(app.getAppPath(), isDev() ? '.' : '..', '/dist-electron/electron/preload.cjs')
}

export function getParallelPreloadPath() {
  return path.join(app.getAppPath(), isDev() ? '.' : '..', '/dist-electron/electron/preload-parallel.cjs')
}

export function getUIPath() {
  return path.join(app.getAppPath(), '/dist-react/index.html')
}

export function getParallelHtmlPath(): string {
  return path.join(app.getAppPath(), '/dist-react/parallel.html') as string
}
