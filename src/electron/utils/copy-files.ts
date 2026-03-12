import { expandHome } from './expand-home.js'
import { GenericError, GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'

export type ClipboardState = {
  filePaths: string[]
  cut: boolean
  timestamp: number
}

// In-memory clipboard state
let clipboardState: ClipboardState | null = null

export async function copyFiles(filePaths: string[], cut: boolean): Promise<GenericResult<void>> {
  try {
    // Expand home directory for all paths
    const expandedPaths = filePaths.map(path => expandHome(path))

    // Store in memory
    clipboardState = {
      filePaths: expandedPaths,
      cut,
      timestamp: Date.now(),
    }

    return Result.Success(undefined)
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message)
    }
    return GenericError.Unknown(error)
  }
}

export function getClipboardState() {
  return clipboardState
}

export function clearClipboardState() {
  clipboardState = null
}

export function setClipboardCutMode(cut: boolean) {
  if (clipboardState) {
    clipboardState.cut = cut
  }
}
