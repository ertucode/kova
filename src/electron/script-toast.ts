import type { ScriptToastLocation, ScriptToastOptions, ScriptToastSeverity } from '../common/ScriptToast.js'

export type ScriptToastBridge = {
  show: (options: ScriptToastOptions) => void
  hide: (id: string) => void
}

export function createScriptToastApi(toastBridge: ScriptToastBridge | undefined) {
  return {
    show(options: ScriptToastOptions) {
      const toast = normalizeScriptToastOptions(options)
      toastBridge?.show(toast)
      return toast.id
    },
    hide(id: string) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('toast.hide requires a non-empty id string')
      }

      toastBridge?.hide(id)
    },
  }
}

function normalizeScriptToastOptions(options: ScriptToastOptions) {
  if (!isPlainObject(options)) {
    throw new Error('toast.show requires a toast options object')
  }

  const severity = normalizeScriptToastSeverity(options.severity)
  const id = typeof options.id === 'string' && options.id.trim() ? options.id : crypto.randomUUID()
  const title = normalizeOptionalScriptToastText(options.title, 'title')
  const message = normalizeOptionalScriptToastText(options.message, 'message')
  const timeout = normalizeOptionalScriptToastTimeout(options.timeout)
  const location = normalizeOptionalScriptToastLocation(options.location)

  return {
    id,
    severity,
    ...(title !== undefined ? { title } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(location !== undefined ? { location } : {}),
  } satisfies ScriptToastOptions & { id: string }
}

function normalizeOptionalScriptToastText(value: unknown, fieldName: 'title' | 'message') {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`toast.show ${fieldName} must be a string`)
  }

  return value
}

function normalizeOptionalScriptToastTimeout(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  if (value === Infinity) {
    return Infinity
  }

  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error('toast.show timeout must be a non-negative number or Infinity')
  }

  return value
}

function normalizeScriptToastSeverity(value: unknown): ScriptToastSeverity {
  switch (value) {
    case 'success':
    case 'error':
    case 'warning':
    case 'info':
      return value
    default:
      throw new Error('toast.show severity must be one of success, error, warning, or info')
  }
}

function normalizeOptionalScriptToastLocation(value: unknown): ScriptToastLocation | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    value === 'top-left' ||
    value === 'top-right' ||
    value === 'top-center' ||
    value === 'bottom-left' ||
    value === 'bottom-right' ||
    value === 'bottom-center'
  ) {
    return value
  }

  throw new Error('toast.show location must be a supported toast location')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
