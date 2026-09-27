import { beforeEach, describe, expect, it } from 'vitest'
import {
  folderExplorerEditorStore,
  getAutoHideFolderExplorer,
  getFolderExplorerPaneIds,
  getNextFolderExplorerPaneId,
  setAutoHideFolderExplorer,
} from './folderExplorerEditorStore'
import type { FolderExplorerTabRecord } from '@common/FolderExplorerTabs'

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

describe('folder explorer panes', () => {
  it('orders an arbitrary number of panes and allocates the next pane ID', () => {
    const tabs = [createTab('tab-10', 'pane:10'), createTab('tab-2', 'pane:2'), createTab('tab-1', 'pane:1')]

    expect(getFolderExplorerPaneIds(tabs)).toEqual(['pane:1', 'pane:2', 'pane:10'])
    expect(getNextFolderExplorerPaneId(tabs)).toBe('pane:11')
  })
})

function createTab(id: string, paneId: string): FolderExplorerTabRecord {
  return {
    id,
    itemType: 'request',
    itemId: id,
    paneId,
    requestMetaTab: null,
    position: 0,
    isPinned: true,
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  }
}
