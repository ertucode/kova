import type { ScriptExecutionPauseController } from './script-prompt.js'

export type ScriptMakeRequestBridge = {
  makeRequest: (path: string[]) => Promise<void>
}

export function createScriptMakeRequestApi(
  makeRequestBridge: ScriptMakeRequestBridge | undefined,
  executionController: ScriptExecutionPauseController
) {
  return async (path: string[]) => {
    if (!makeRequestBridge) {
      throw new Error('makeRequest is not available in this context')
    }

    const normalizedPath = normalizeScriptMakeRequestPath(path)
    executionController.pause()
    try {
      await makeRequestBridge.makeRequest(normalizedPath)
    } finally {
      executionController.resume()
    }
  }
}

function normalizeScriptMakeRequestPath(path: string[]) {
  if (!Array.isArray(path)) {
    throw new Error('makeRequest requires an array path')
  }

  if (path.length === 0) {
    throw new Error('makeRequest path must contain at least one segment')
  }

  return path.map((segment, index) => {
    if (typeof segment !== 'string') {
      throw new Error(`makeRequest path segment ${index + 1} must be a string`)
    }

    const normalizedSegment = segment.trim()
    if (!normalizedSegment) {
      throw new Error(`makeRequest path segment ${index + 1} cannot be empty`)
    }

    return normalizedSegment
  })
}
