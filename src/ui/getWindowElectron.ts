import { WindowElectron } from '@common/Contracts'
import { deserializeWindowArguments } from '@common/WindowArguments'

export function getWindowElectron() {
  return (window as any).electron as WindowElectron
}

const windowArgsStr =
  getWindowElectron().getWindowArgs() || new URLSearchParams(window.location.search).get('window-args') || ''

export const args = deserializeWindowArguments(windowArgsStr)

export const windowArgs = {
  ...args,
  isSelectAppMode: args.mode === 'select-app',
}
console.log('windowArgs', windowArgs)

export const homeDirectory = windowArgs.homeDir
