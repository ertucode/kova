import type { ScriptExecutionPauseController } from './script-prompt.js'
import type { ScriptCallRequestPayload } from '../common/ScriptMakeRequest.js'

export type ScriptMakeRequestBridge = {
  navigateAndCallRequest: (path: string[]) => Promise<void>
  callRequest: (path: string[]) => Promise<ScriptCallRequestPayload>
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
  return async (path: string[]) => {
    if (!makeRequestBridge) {
      throw new Error('callRequest is not available in this context')
    }

    const normalizedPath = normalizeScriptMakeRequestPath(path)
    executionController.pause()
    try {
      return await makeRequestBridge.callRequest(normalizedPath)
    } finally {
      executionController.resume()
    }
  }
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
