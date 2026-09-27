import { beforeEach, describe, expect, it } from 'vitest'
import {
  folderExplorerEditorStore,
  getAutoHideFolderExplorer,
  setAutoHideFolderExplorer,
} from './folderExplorerEditorStore'

describe('folder explorer display preference', () => {
  beforeEach(() => {
    setAutoHideFolderExplorer(false)
    localStorage.clear()
  })

  it('persists auto-hide and closes the transient overlay', () => {
    folderExplorerEditorStore.trigger.folderExplorerOverlayVisibilityChanged({ open: true })

    setAutoHideFolderExplorer(true)

    expect(getAutoHideFolderExplorer()).toBe(true)
    expect(folderExplorerEditorStore.getSnapshot().context.folderExplorerOverlayOpen).toBe(false)
    expect(JSON.parse(localStorage.getItem('folderExplorer:uiState') ?? '{}')).toMatchObject({
      autoHideFolderExplorer: true,
    })
  })
})
