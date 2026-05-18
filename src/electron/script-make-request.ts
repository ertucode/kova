import type { ScriptExecutionPauseController } from './script-prompt.js'
import type { ScriptCallRequestOverrides, ScriptCallRequestPayload } from '../common/ScriptMakeRequest.js'

export type ScriptMakeRequestBridge = {
  navigateAndCallRequest: (path: string[]) => Promise<void>
  callRequest: (path: string[], overrides?: ScriptCallRequestOverrides) => Promise<ScriptCallRequestPayload>
}

export function createScriptMakeRequestApi(
  makeRequestBridge: ScriptMakeRequestBridge | undefined,
  executionController: ScriptExecutionPauseController
) {
  return async (path: string[]) => {
    if (!makeRequestBridge) {
      throw new Error('navigateAndCallRequest is not available in this context')
    }

    const normalizedPath = normalizeScriptMakeRequestPath(path)
    executionController.pause()
    try {
      await makeRequestBridge.navigateAndCallRequest(normalizedPath)
    } finally {
      executionController.resume()
    }
  }
}

export function createScriptCallRequestApi(
  makeRequestBridge: ScriptMakeRequestBridge | undefined,
  executionController: ScriptExecutionPauseController
) {
  return async (path: string[], overrides?: ScriptCallRequestOverrides) => {
    if (!makeRequestBridge) {
      throw new Error('callRequest is not available in this context')
    }

    const normalizedPath = normalizeScriptMakeRequestPath(path)
    const normalizedOverrides = normalizeScriptCallRequestOverrides(overrides)
    executionController.pause()
    try {
      return await makeRequestBridge.callRequest(normalizedPath, normalizedOverrides)
    } finally {
      executionController.resume()
    }
  }
}

function normalizeScriptCallRequestOverrides(overrides: ScriptCallRequestOverrides | undefined) {
  if (overrides === undefined) {
    return undefined
  }

  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw new Error('callRequest overrides must be an object')
  }

  const normalized: ScriptCallRequestOverrides = {}

  if (Object.hasOwn(overrides, 'method')) {
    if (typeof overrides.method !== 'string') {
      throw new Error('callRequest override method must be a string')
    }

    normalized.method = overrides.method
  }

  if (Object.hasOwn(overrides, 'url')) {
    if (typeof overrides.url !== 'string') {
      throw new Error('callRequest override url must be a string')
    }

    normalized.url = overrides.url
  }

  if (Object.hasOwn(overrides, 'body')) {
    if (overrides.body !== undefined && typeof overrides.body !== 'string') {
      throw new Error('callRequest override body must be a string or undefined')
    }

    normalized.body = overrides.body
  }

  if (Object.hasOwn(overrides, 'headers')) {
    const { headers } = overrides
    if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) {
      throw new Error('callRequest override headers must be an object or undefined')
    }

    if (headers === undefined) {
      normalized.headers = undefined
    } else {
      const normalizedHeaders: Record<string, string | undefined> = {}
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined && typeof value !== 'string') {
          throw new Error(`callRequest override header ${name} must be a string or undefined`)
        }

        normalizedHeaders[name] = value
      }

      normalized.headers = normalizedHeaders
    }
  }

  return normalized
}

function normalizeScriptMakeRequestPath(path: string[]) {
  if (!Array.isArray(path)) {
    throw new Error('navigateAndCallRequest requires an array path')
  }

  if (path.length === 0) {
    throw new Error('navigateAndCallRequest path must contain at least one segment')
  }

  return path.map((segment, index) => {
    if (typeof segment !== 'string') {
      throw new Error(`navigateAndCallRequest path segment ${index + 1} must be a string`)
    }

    const normalizedSegment = segment.trim()
    if (!normalizedSegment) {
      throw new Error(`navigateAndCallRequest path segment ${index + 1} cannot be empty`)
    }

    return normalizedSegment
  })
}
