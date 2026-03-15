import { useEffect, useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { CopyIcon, FileCode2Icon, FolderIcon, XIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuList,
  type ForgivingContextMenuItem,
  useContextMenu,
} from '@/lib/components/context-menu'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore, isEntryDirty } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'

type FolderExplorerTabViewModel = {
  id: string
  itemType: 'folder' | 'request' | 'example'
  itemId: string
  position: number
  isPinned: boolean
  isActive: boolean
  createdAt: number
  updatedAt: number
  name: string
  isSaving: boolean
  isDirty: boolean
  method: string | null
  requestType: 'http' | 'websocket' | null
  exampleType: 'http' | 'websocket' | null
}

export function FolderExplorerTabs() {
  const tabs = useSelector(folderExplorerEditorStore, state => state.context.tabs)
  const activeTabId = useSelector(folderExplorerEditorStore, state => state.context.activeTabId)
  const entries = useSelector(folderExplorerEditorStore, state => state.context.entries)
  const items = useSelector(folderExplorerTreeStore, state => state.context.items)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const menu = useContextMenu<FolderExplorerTabViewModel>()

  const tabsWithState = useMemo<FolderExplorerTabViewModel[]>(
    () =>
      tabs.map(tab => {
        const entry = entries[`${tab.itemType}:${tab.itemId}`]
        const item = items.find(currentItem => currentItem.itemType === tab.itemType && currentItem.id === tab.itemId)
        return {
          ...tab,
          name: entry?.current?.name ?? item?.name ?? 'Untitled',
          isSaving: Boolean(entry?.saving),
          isDirty: Boolean(entry && isEntryDirty(entry)),
          method: item?.itemType === 'request' ? item.method : null,
          requestType: item?.itemType === 'request' ? item.requestType : null,
          exampleType: item?.itemType === 'example' ? item.exampleType : null,
        }
      }),
    [entries, items, tabs]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeTabId && event.metaKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void FolderExplorerCoordinator.closeActiveTab()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeTabId])

  const clearDragState = () => {
    setDraggedTabId(null)
    setDropIndex(null)
  }

  const handleDrop = async (targetIndex: number) => {
    if (!draggedTabId) {
      clearDragState()
      return
    }

    await FolderExplorerCoordinator.moveTab(draggedTabId, targetIndex)
    clearDragState()
  }

  if (tabsWithState.length === 0) {
    return (
      <div className="flex h-11 items-center border-b border-base-content/10 px-4 text-sm text-base-content/35">
        No open tabs
      </div>
    )
  }

  return (
    <>
      <div className="flex h-11 items-stretch gap-1 overflow-x-auto border-b border-base-content/10 bg-base-100/95 px-2 py-1.5">
        {tabsWithState.map((tab, index) => {
          const isActive = tab.id === activeTabId
          const showDropBefore = dropIndex === index
          const showDropAfter = dropIndex === tabsWithState.length && index === tabsWithState.length - 1

          return (
            <div key={tab.id} className="relative flex shrink-0">
              {showDropBefore ? <div className="absolute inset-y-1 -left-0.5 w-0.5 rounded-full bg-primary" /> : null}
              <div
                draggable
                className={[
                  'group flex min-w-[180px] max-w-[280px] items-center gap-2 rounded-xl border px-3 text-sm transition',
                  isActive
                    ? 'border-base-content/12 bg-base-100 text-base-content shadow-[0_10px_24px_rgba(0,0,0,0.10)]'
                    : 'border-transparent bg-base-200/40 text-base-content/70 hover:border-base-content/10 hover:bg-base-200/65',
                  draggedTabId === tab.id ? 'opacity-50' : '',
                ].join(' ')}
                onClick={() => void FolderExplorerCoordinator.activateTab(tab.id)}
                onDoubleClick={() => void FolderExplorerCoordinator.pinTab(tab.id)}
                onContextMenu={event => menu.onRightClick(event, tab)}
                onDragStart={event => {
                  setDraggedTabId(tab.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', tab.id)
                }}
                onDragEnd={clearDragState}
                onDragOver={event => {
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  const nextIndex = event.clientX < rect.left + rect.width / 2 ? index : index + 1
                  setDropIndex(nextIndex)
                  event.dataTransfer.dropEffect = 'move'
                }}
                onDrop={event => {
                  event.preventDefault()
                  void handleDrop(dropIndex ?? index)
                }}
              >
                <div className="flex shrink-0 items-center justify-center text-base-content/55">
                  {tab.itemType === 'folder' ? (
                    <FolderIcon className="size-4" />
                  ) : tab.itemType === 'request' ? (
                    <RequestMethodGlyph method={tab.method} requestType={tab.requestType} />
                  ) : (
                    <ExampleGlyph exampleType={tab.exampleType} />
                  )}
                </div>

                <div className={['min-w-0 flex-1 truncate', tab.isPinned ? '' : 'italic'].join(' ')}>{tab.name}</div>

                {tab.isSaving || tab.isDirty ? (
                  <div
                    className={['size-2 shrink-0 rounded-full', tab.isSaving ? 'bg-info' : 'bg-warning'].join(' ')}
                    title={tab.isSaving ? 'Saving changes' : 'Unsaved changes'}
                    aria-label={tab.isSaving ? 'Saving changes' : 'Unsaved changes'}
                  />
                ) : null}

                <button
                  type="button"
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-base-content/45 transition hover:bg-base-200 hover:text-base-content"
                  onClick={event => {
                    event.stopPropagation()
                    void FolderExplorerCoordinator.closeTab(tab.id)
                  }}
                  aria-label="Close tab"
                  title="Close tab"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
              {showDropAfter ? <div className="absolute inset-y-1 -right-0.5 w-0.5 rounded-full bg-primary" /> : null}
            </div>
          )
        })}
      </div>

      {menu.isOpen && menu.item ? (
        <ContextMenu menu={menu}>
          <ContextMenuList items={getTabMenuItems(menu.item, tabsWithState)} />
        </ContextMenu>
      ) : null}
    </>
  )
}

function getTabMenuItems(
  tab: FolderExplorerTabViewModel,
  tabs: FolderExplorerTabViewModel[]
): ForgivingContextMenuItem[] {
  const hasOtherTabs = tabs.some(currentTab => currentTab.id !== tab.id)
  const hasSavedTabs = tabs.some(currentTab => !currentTab.isDirty)

  const items: ForgivingContextMenuItem[] = [
    {
      view: 'Close Tab',
      onClick: () => {
        void FolderExplorerCoordinator.closeTab(tab.id)
      },
    },
  ]

  if (hasOtherTabs) {
    items.push({
      view: 'Close All Other Tabs',
      onClick: () => {
        void FolderExplorerCoordinator.closeOtherTabs(tab.id)
      },
    })
  }

  if (hasSavedTabs) {
    items.push({
      view: 'Close All Saved',
      onClick: () => {
        void FolderExplorerCoordinator.closeAllSavedTabs()
      },
    })
  }

  items.push({
    view: 'Close All Tabs',
    onClick: () => {
      void FolderExplorerCoordinator.closeAllTabs()
    },
  })

  items.push(
    { isSeparator: true },
    {
      view: 'Save And Close Tab',
      onClick: () => {
        void FolderExplorerCoordinator.saveAndCloseTab(tab.id)
      },
    },
    {
      view: 'Save And Close All Tabs',
      onClick: () => {
        void FolderExplorerCoordinator.saveAndCloseAllTabs()
      },
    }
  )

  if (hasOtherTabs) {
    items.push({
      view: 'Save And Close All Other Tabs',
      onClick: () => {
        void FolderExplorerCoordinator.saveAndCloseOtherTabs(tab.id)
      },
    })
  }

  items.push({ isSeparator: true })

  return items
}

function RequestMethodGlyph({
  method,
  requestType,
}: {
  method: string | null
  requestType: 'http' | 'websocket' | null
}) {
  if (requestType === 'websocket') {
    return <span className="w-8 text-center text-[10px] font-semibold tracking-[0.12em] text-accent">WS</span>
  }

  if (!method) {
    return <FileCode2Icon className="size-4" />
  }

  return (
    <span className="w-8 text-center text-[10px] font-semibold tracking-[0.12em] text-base-content/70">
      {method === 'DELETE' ? 'DEL' : method}
    </span>
  )
}

function ExampleGlyph({ exampleType }: { exampleType: 'http' | 'websocket' | null }) {
  return (
    <div className="relative flex size-5 items-center justify-center text-base-content/55">
      <CopyIcon className="size-4" />
      <span
        className={[
          'absolute -right-1.5 -top-1 text-[7px] font-semibold leading-none tracking-[0.08em]',
          exampleType === 'websocket' ? 'text-accent' : 'text-info',
        ].join(' ')}
      >
        {exampleType === 'websocket' ? 'WS' : 'EX'}
      </span>
    </div>
  )
}
