import { createContext, useContext, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import { DEFAULT_FOLDER_EXPLORER_PANE_ID, type FolderExplorerPaneId } from '@common/FolderExplorerTabs'
import { folderExplorerEditorStore, getActiveTabIdForPane, getSelectionFromTabs } from './folderExplorerEditorStore'

const FolderExplorerPaneContext = createContext<FolderExplorerPaneId>(DEFAULT_FOLDER_EXPLORER_PANE_ID)

export function FolderExplorerPaneProvider({ paneId, children }: { paneId: FolderExplorerPaneId; children: ReactNode }) {
  return <FolderExplorerPaneContext value={paneId}>{children}</FolderExplorerPaneContext>
}

export function useFolderExplorerPaneId() {
  return useContext(FolderExplorerPaneContext)
}

export function useFolderExplorerPaneSelection() {
  const paneId = useFolderExplorerPaneId()
  const tabs = useSelector(folderExplorerEditorStore, state => state.context.tabs)
  const activeTabId = getActiveTabIdForPane(tabs, paneId)
  return getSelectionFromTabs(tabs, activeTabId)
}

export function useFolderExplorerPaneTab() {
  const paneId = useFolderExplorerPaneId()
  return useSelector(folderExplorerEditorStore, state => {
    const activeTabId = getActiveTabIdForPane(state.context.tabs, paneId)
    return state.context.tabs.find(tab => tab.id === activeTabId) ?? null
  })
}
