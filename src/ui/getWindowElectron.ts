import type { WindowElectron } from '@common/Contracts'
import { deserializeWindowArguments, type WindowArguments } from '@common/WindowArguments'

type WindowWithElectron = Window & {
  electron?: WindowElectron
}

const fallbackWindowElectron = createFallbackWindowElectron()

export function getWindowElectron() {
  return (window as WindowWithElectron).electron ?? fallbackWindowElectron
}

const windowArgsStr = readWindowArgsString()

export const args = parseWindowArguments(windowArgsStr)

export const windowArgs = {
  ...args,
  isSelectAppMode: args.mode === 'select-app',
}

export const homeDirectory = windowArgs.homeDir

function readWindowArgsString() {
  return getWindowElectron().getWindowArgs() || new URLSearchParams(window.location.search).get('window-args') || ''
}

function parseWindowArguments(value: string): WindowArguments {
  if (!value) {
    return {
      homeDir: '',
      isDev: false,
    }
  }

  try {
    return deserializeWindowArguments(value)
  } catch {
    return {
      homeDir: '',
      isDev: false,
    }
  }
}

function createFallbackWindowElectron(): WindowElectron {
  const fallback = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'getWindowArgs') {
          return () => new URLSearchParams(window.location.search).get('window-args') || ''
        }

        if (property === 'onTaskEvent' || property === 'onGenericEvent') {
          return () => () => undefined
        }

        if (property === 'onWindowFocus') {
          return () => () => undefined
        }

        return () => {
          throw new Error(`window.electron.${String(property)} is not available in this runtime.`)
        }
      },
    }
  )

  return fallback as WindowElectron
}
