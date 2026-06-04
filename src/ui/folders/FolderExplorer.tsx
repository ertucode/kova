import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useSelector } from '@xstate/store/react'
import {
  CookieIcon,
  Clock3Icon,
  FileCode2Icon,
  FileJsonIcon,
  FlaskConicalIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PackageIcon,
  SearchIcon,
  TagIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react'
import type { ExplorerDropTarget, Selection, TreeNode } from './folderExplorerTypes'
import { DetailsPanel } from './DetailsPanel'
import { FolderExplorerTabs } from './FolderExplorerTabs'
import { DraftRow, EmptyState, ExplorerRow } from './ExplorerRow'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { EnvironmentsPanel } from './EnvironmentsPanel'
import { ChangesPanel } from './ChangesPanel'
import { CookiesPanel } from './CookiesPanel'
import { HistoryPanel } from './RequestExecutionPanels'
import { SharedScriptsPanel } from './SharedScriptsPanel'
import { PackagesPanel } from './PackagesPanel'
import { ViewsPanel } from './ViewsPanel'
import { TagsPanel } from './TagsPanel'
import { TagsCoordinator } from './tagsCoordinator'
import { captureFolderTreeSearchSnapshot, filterTreeWithDrafts, type FolderTreeSearchSnapshot } from './folderExplorerSearch'
import { buildTree, toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore, type SidebarTab } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { RequestExecutionCoordinator, requestExecutionStore } from './requestExecutionStore'
import { dialogActions } from '@/global/dialogStore'
import { OpenApiExportDialog } from './OpenApiExportDialog'
import { OpenApiImportDialog } from './OpenApiImportDialog'
import { PostmanEnvironmentImportDialog } from './PostmanEnvironmentImportDialog'
import { PostmanImportDialog } from './PostmanImportDialog'
import { PostmanExportDialog } from './PostmanExportDialog'
import { tagsStore } from './tagsStore'

type DropPlacement = ExplorerDropTarget['placement']
const TREE_SEARCH_DEBOUNCE_MS = 5

type SearchSnapshot = FolderTreeSearchSnapshot

type ExplorerItem = ReturnType<typeof folderExplorerTreeStore.getSnapshot>['context']['items'][number]

export function FolderExplorer() {
  const items = useSelector(folderExplorerTreeStore, state => state.context.items)
  const searchQuery = useSelector(folderExplorerTreeStore, state => state.context.searchQuery)
  const createDraft = useSelector(folderExplorerTreeStore, state => state.context.createDraft)
  const sidebarTab = useSelector(folderExplorerEditorStore, state => state.context.sidebarTab)
  const expandedIds = useSelector(folderExplorerEditorStore, state => state.context.expandedIds)
  const selected = useSelector(folderExplorerEditorStore, state => state.context.selected)
  const selectionScrollTarget = useSelector(folderExplorerEditorStore, state => state.context.selectionScrollTarget)
  const [draggedItem, setDraggedItem] = useState<Selection | null>(null)
  const [dropTarget, setDropTarget] = useState<ExplorerDropTarget | null>(null)
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery)
  const [searchCollapsedIds, setSearchCollapsedIds] = useState<string[]>([])
  const sidebarScrollContainerRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const pendingSearchQueryRef = useRef(searchQuery)

  useEffect(() => {
    void FolderExplorerCoordinator.initialize()
    void EnvironmentCoordinator.loadEnvironments()
    void TagsCoordinator.loadTags()
    void RequestExecutionCoordinator.ensureRecentHttpRequestUsageLoaded()
  }, [])

  const { roots, itemMap } = useMemo(() => buildTree(items), [items])
  const latestTreeRef = useRef({ items, roots })
  const [searchSnapshot, setSearchSnapshot] = useState<SearchSnapshot | null>(() =>
    searchQuery.trim() ? captureSearchSnapshot({ items, roots }) : null
  )
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const isSearchActive = normalizedSearch.length > 0

  useEffect(() => {
    latestTreeRef.current = { items, roots }
  }, [items, roots])

  useEffect(() => {
    if (searchQuery !== pendingSearchQueryRef.current) {
      setLocalSearchQuery(searchQuery)
      pendingSearchQueryRef.current = searchQuery
    }

    setSearchSnapshot(searchQuery.trim() ? captureSearchSnapshot(latestTreeRef.current) : null)
  }, [searchQuery])

  useEffect(() => {
    if (localSearchQuery === searchQuery) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      pendingSearchQueryRef.current = localSearchQuery
      FolderExplorerCoordinator.updateTreeSearchQuery(localSearchQuery)
    }, TREE_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [localSearchQuery, searchQuery])

  const visibleRoots = useMemo(() => {
    if (!isSearchActive) {
      return roots
    }

    const snapshot = searchSnapshot
    if (!snapshot) {
      return roots
    }

    return filterTreeWithDrafts(
      snapshot.roots,
      normalizedSearch,
      snapshot.entries,
      snapshot.tagNamesBySelection,
      snapshot.recentHttpRequestUsageCountByRequestId,
      snapshot.recentHttpRequestUsageVersion
    )
  }, [isSearchActive, normalizedSearch, roots, searchSnapshot])
  const searchAutoExpandedIds = useMemo(
    () => (isSearchActive ? collectExpandableNodeIds(visibleRoots) : []),
    [isSearchActive, visibleRoots]
  )
  const searchAutoExpandedIdSet = useMemo(() => new Set(searchAutoExpandedIds), [searchAutoExpandedIds])
  const searchCollapsedIdSet = useMemo(() => new Set(searchCollapsedIds), [searchCollapsedIds])
  const expandedIdSet = useMemo(() => new Set(expandedIds), [expandedIds])

  const isNodeExpanded = (nodeId: string) => {
    if (!isSearchActive) {
      return expandedIdSet.has(nodeId)
    }

    if (searchCollapsedIdSet.has(nodeId)) {
      return false
    }

    return searchAutoExpandedIdSet.has(nodeId) || expandedIdSet.has(nodeId)
  }

  const visibleNodes = useMemo(() => flattenVisibleNodes(visibleRoots, isNodeExpanded), [visibleRoots, isNodeExpanded])
  const canDrag = normalizedSearch.length === 0 && createDraft === null

  useEffect(() => {
    setSearchCollapsedIds([])
  }, [normalizedSearch])

  const handleToggleExpanded = (nodeId: string) => {
    if (!isSearchActive) {
      FolderExplorerCoordinator.toggleExpanded(nodeId)
      return
    }

    setSearchCollapsedIds(current => {
      const isCurrentlyExpanded = isNodeExpanded(nodeId)
      if (!isCurrentlyExpanded) {
        return current.filter(id => id !== nodeId)
      }

      return current.includes(nodeId) ? current : [...current, nodeId]
    })
  }

  useEffect(() => {
    if (sidebarTab !== 'requests' || !selectionScrollTarget) {
      return
    }

    const selectionKey = toSelectionKey(selectionScrollTarget)
    const frameId = window.requestAnimationFrame(() => {
      const selectedRow = sidebarScrollContainerRef.current?.querySelector<HTMLElement>(
        `[data-selection-key="${CSS.escape(selectionKey)}"]`
      )
      selectedRow?.scrollIntoView({ behavior: 'instant', block: 'center' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectionScrollTarget, sidebarTab])

  const handleTagShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }

    if (event.code === 'Digit0') {
      event.preventDefault()
      if (sidebarTab !== 'requests') {
        EnvironmentCoordinator.setSidebarTab('requests')
      }
      FolderExplorerCoordinator.updateTreeSearchQuery('')
      window.requestAnimationFrame(() => searchInputRef.current?.focus())
      return
    }

    if (!/^Digit[1-9]$/u.test(event.code)) {
      return
    }

    const tagIndex = Number(event.code.slice('Digit'.length)) - 1
    const { items: tagItems, assignments: tagAssignments } = tagsStore.getSnapshot().context
    const tag = tagItems[tagIndex]
    if (!tag) {
      return
    }

    event.preventDefault()
    if (sidebarTab !== 'requests') {
      EnvironmentCoordinator.setSidebarTab('requests')
    }

    const nextQuery = `@${tag.name}`
    if (searchQuery.trim() === nextQuery) {
      const taggedSelections = items
        .filter(
          (item): item is Extract<(typeof items)[number], { itemType: 'folder' | 'request' }> =>
            item.itemType === 'folder' || item.itemType === 'request'
        )
        .filter(item =>
          tagAssignments.some(
            assignment =>
              assignment.tagId === tag.id && assignment.itemType === item.itemType && assignment.itemId === item.id
          )
        )
        .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
        .map(item => ({ itemType: item.itemType, id: item.id }) as const)

      void (async () => {
        await FolderExplorerCoordinator.closeAllTabs()
        for (const selection of taggedSelections) {
          await FolderExplorerCoordinator.selectItem(selection, { mode: 'pin' })
        }
        if (taggedSelections[0]) {
          await FolderExplorerCoordinator.selectItem(taggedSelections[0], { mode: 'pin' })
        }
      })()
      return
    }

    FolderExplorerCoordinator.updateTreeSearchQuery(nextQuery)
    window.requestAnimationFrame(() => searchInputRef.current?.focus())
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => handleTagShortcut(event)
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTagShortcut])

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const firstRequestNode = visibleNodes.find(node => node.itemType === 'request')
      if (!firstRequestNode) {
        return
      }

      event.preventDefault()
      void FolderExplorerCoordinator.selectItem({ itemType: 'request', id: firstRequestNode.id })
      return
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
      return
    }

    const direction = event.key === 'j' ? 1 : event.key === 'k' ? -1 : 0
    if (direction === 0 || visibleNodes.length === 0) {
      return
    }

    event.preventDefault()

    const currentIndex = selected
      ? visibleNodes.findIndex(node => node.itemType === selected.itemType && node.id === selected.id)
      : -1
    const fallbackIndex = direction > 0 ? 0 : visibleNodes.length - 1
    const nextIndex =
      currentIndex < 0 ? fallbackIndex : Math.max(0, Math.min(visibleNodes.length - 1, currentIndex + direction))
    const nextNode = visibleNodes[nextIndex]
    if (!nextNode) {
      return
    }

    void FolderExplorerCoordinator.selectItem({ itemType: nextNode.itemType, id: nextNode.id }, { mode: 'preview' })
  }

  const clearDragState = () => {
    setDraggedItem(null)
    setDropTarget(null)
  }

  const handleDragStart = (node: TreeNode, event: DragEvent<HTMLDivElement>) => {
    if (!canDrag) {
      event.preventDefault()
      return
    }

    const selection = { itemType: node.itemType, id: node.id } satisfies Selection
    setDraggedItem(selection)
    setDropTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', toSelectionKey(selection))
  }

  const handleDragEnd = () => {
    clearDragState()
  }

  const handleRowDragOver = (node: TreeNode, event: DragEvent<HTMLDivElement>) => {
    if (!canDrag || !draggedItem) {
      return
    }

    const nextDropTarget = getRowDropTarget({ draggedItem, itemMap, roots, node, event })
    if (!nextDropTarget) {
      setDropTarget(null)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(current => (isSameDropTarget(current, nextDropTarget) ? current : nextDropTarget))
  }

  const handleRowDrop = async (node: TreeNode, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!canDrag || !draggedItem) {
      clearDragState()
      return
    }

    const nextDropTarget = dropTarget ?? getRowDropTarget({ draggedItem, itemMap, roots, node, event })
    const itemToMove = draggedItem
    clearDragState()

    if (!nextDropTarget) {
      return
    }

    await FolderExplorerCoordinator.moveItem({
      ...(itemToMove.itemType === 'example'
        ? {
            itemType: 'example' as const,
            id: itemToMove.id,
            targetRequestId: nextDropTarget.targetRequestId ?? '',
            targetPosition: nextDropTarget.targetPosition,
          }
        : {
            itemType: itemToMove.itemType as 'folder' | 'request',
            id: itemToMove.id,
            targetParentFolderId: nextDropTarget.targetParentFolderId,
            targetPosition: nextDropTarget.targetPosition,
          }),
    })
  }

  const handleRootEndDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!canDrag || !draggedItem) {
      return
    }

    const nextDropTarget = getRootEndDropTarget(roots, draggedItem)
    if (!nextDropTarget) {
      setDropTarget(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(current => (isSameDropTarget(current, nextDropTarget) ? current : nextDropTarget))
  }

  const handleRootEndDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    if (!canDrag || !draggedItem) {
      clearDragState()
      return
    }

    const nextDropTarget = getRootEndDropTarget(roots, draggedItem)
    if (!nextDropTarget) {
      clearDragState()
      return
    }
    const itemToMove = draggedItem
    clearDragState()

    await FolderExplorerCoordinator.moveItem(
      itemToMove.itemType === 'example'
        ? {
            itemType: 'example',
            id: itemToMove.id,
            targetRequestId: nextDropTarget.targetRequestId ?? '',
            targetPosition: nextDropTarget.targetPosition,
          }
        : {
            itemType: itemToMove.itemType,
            id: itemToMove.id,
            targetParentFolderId: nextDropTarget.targetParentFolderId,
            targetPosition: nextDropTarget.targetPosition,
          }
    )
  }

  return (
    <div className="flex min-h-0 flex-1 bg-base-100">
      <SidebarTabs sidebarTab={sidebarTab} />

      {sidebarTab === 'requests' ? (
        <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-base-100">
          <div className="h-11 border-b border-base-content/10 px-2 py-1.5">
            <div className="flex h-full items-center gap-2">
              <CreateMenuButton />

              <label className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content/60 focus-within:border-base-content/25 focus-within:bg-base-100">
                <SearchIcon className="size-4 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  id="folder-explorer-search-input"
                  className="w-full bg-transparent outline-none placeholder:text-base-content/35"
                  placeholder="Search folders and requests"
                  value={localSearchQuery}
                  onChange={event => setLocalSearchQuery(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                {localSearchQuery.length > 0 && (
                  <button
                    onClick={() => {
                      setLocalSearchQuery('')
                      searchInputRef.current?.focus()
                    }}
                  >
                    <XIcon className="size-4 shrink-0" />
                  </button>
                )}
              </label>
            </div>
          </div>

          <div ref={sidebarScrollContainerRef} className="min-h-0 flex-1 overflow-auto py-3">
            {createDraft?.parentFolderId === null ? (
              <DraftRow
                value={createDraft.name}
                depth={0}
                icon={createDraft.itemType}
                onChange={FolderExplorerCoordinator.changeCreateName}
                onSubmit={() => void FolderExplorerCoordinator.submitCreate()}
                onCancel={FolderExplorerCoordinator.cancelCreate}
              />
            ) : null}

            {items.length === 0 ? (
              <EmptyState title="No items yet" description="Create your first folder or request to get started." />
            ) : visibleRoots.length === 0 ? (
              <EmptyState title="No matches" description="Try a different item name." />
            ) : (
              <div>
                {visibleRoots.map(node => (
                  <ExplorerRow
                    key={`${node.itemType}:${node.id}`}
                    node={node}
                    depth={0}
                    isExpanded={isNodeExpanded}
                    canDrag={canDrag}
                    draggedItem={draggedItem}
                    dropTarget={dropTarget}
                    onToggleExpanded={handleToggleExpanded}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onRowDragOver={handleRowDragOver}
                    onRowDrop={handleRowDrop}
                  />
                ))}

                {canDrag && draggedItem ? (
                  <div
                    className={[
                      'mx-3 mt-1 h-5 rounded-lg transition',
                      dropTarget?.indicatorId === 'root:end' ? 'bg-base-content/8' : 'bg-transparent',
                    ].join(' ')}
                    onDragOver={handleRootEndDragOver}
                    onDrop={event => void handleRootEndDrop(event)}
                  >
                    {dropTarget?.indicatorId === 'root:end' ? (
                      <div className="translate-y-[9px] border-t border-primary" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
        {sidebarTab === 'requests' ? <FolderExplorerTabs /> : null}
        {sidebarTab === 'requests' ? <DetailsPanel /> : null}
        {sidebarTab === 'views' ? <ViewsPanel /> : null}
        {sidebarTab === 'scripts' ? <SharedScriptsPanel /> : null}
        {sidebarTab === 'environments' ? <EnvironmentsPanel /> : null}
        {sidebarTab === 'tags' ? <TagsPanel /> : null}
        {sidebarTab === 'cookies' ? <CookiesPanel /> : null}
        {sidebarTab === 'history' ? <HistoryPanel /> : null}
        {sidebarTab === 'changes' ? <ChangesPanel /> : null}
        {sidebarTab === 'packages' ? <PackagesPanel /> : null}
      </main>
    </div>
  )
}

function captureSearchSnapshot({ items, roots }: { items: ExplorerItem[]; roots: TreeNode[] }): SearchSnapshot {
  const { entries } = folderExplorerEditorStore.getSnapshot().context
  const { items: tagItems, assignments: tagAssignments } = tagsStore.getSnapshot().context
  const { recentHttpRequestUsageCountByRequestId, recentHttpRequestUsageVersion } =
    requestExecutionStore.getSnapshot().context

  return captureFolderTreeSearchSnapshot({
    items,
    roots,
    entries,
    tagItems,
    tagAssignments,
    recentHttpRequestUsageCountByRequestId,
    recentHttpRequestUsageVersion,
  })
}

function flattenVisibleNodes(nodes: TreeNode[], isExpanded: (nodeId: string) => boolean) {
  const flattened: TreeNode[] = []

  const visit = (node: TreeNode) => {
    flattened.push(node)

    if (isExpanded(node.id) && (node.itemType === 'folder' || node.itemType === 'request')) {
      node.children.forEach(visit)
    }
  }

  nodes.forEach(visit)

  return flattened
}

function collectExpandableNodeIds(nodes: TreeNode[]) {
  const ids: string[] = []

  const visit = (node: TreeNode) => {
    if ((node.itemType === 'folder' || node.itemType === 'request') && node.children.length > 0) {
      ids.push(node.id)
      node.children.forEach(visit)
    }
  }

  nodes.forEach(visit)

  return ids
}

function CreateMenuButton() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const runAction = (action: () => void) => {
    setIsOpen(false)
    action()
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        className="flex h-8 items-center rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-sm font-medium text-base-content transition hover:border-base-content/20 hover:bg-base-100"
        onClick={() => setIsOpen(current => !current)}
      >
        <MoreHorizontalIcon className="size-4" />
      </button>

      {isOpen ? (
        <ul className="menu absolute left-0 top-full z-20 mt-1 w-48 rounded-xl border border-base-content/10 bg-base-100 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
          <li>
            <button
              type="button"
              onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('folder', null))}
            >
              <FolderIcon className="size-4" />
              Add Folder
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('request', null, 'http'))}
            >
              <FileCode2Icon className="size-4" />
              Add HTTP Request
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('request', null, 'websocket'))}
            >
              <FileCode2Icon className="size-4" />
              Add WebSocket
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() =>
                runAction(() => dialogActions.open({ component: PostmanExportDialog, props: { scope: 'workspace' } }))
              }
            >
              <FileJsonIcon className="size-4" />
              Export Postman
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() =>
                runAction(() => dialogActions.open({ component: OpenApiExportDialog, props: { scope: 'workspace' } }))
              }
            >
              <FileJsonIcon className="size-4" />
              Export OpenAPI
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => runAction(() => dialogActions.open({ component: PostmanImportDialog, props: {} }))}
            >
              <FileCode2Icon className="size-4" />
              Import Postman
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => runAction(() => dialogActions.open({ component: OpenApiImportDialog, props: {} }))}
            >
              <FileCode2Icon className="size-4" />
              Import OpenAPI
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() =>
                runAction(() => dialogActions.open({ component: PostmanEnvironmentImportDialog, props: {} }))
              }
            >
              <FileCode2Icon className="size-4" />
              Import Environment
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

function SidebarTabs({ sidebarTab }: { sidebarTab: SidebarTab }) {
  const tabs = [
    { id: 'requests', label: 'Requests', icon: FileCode2Icon, disabled: false },
    { id: 'environments', label: 'Envs', icon: FlaskConicalIcon, disabled: false },
    { id: 'views', label: 'Views', icon: FileCode2Icon, disabled: false },
    { id: 'tags', label: 'Tags', icon: TagIcon, disabled: false },
    { id: 'history', label: 'History', icon: Clock3Icon, disabled: false },
    { id: 'changes', label: 'Changes', icon: Undo2Icon, disabled: false },
    { id: 'scripts', label: 'Scripts', icon: FileJsonIcon, disabled: false },
    { id: 'packages', label: 'Packages', icon: PackageIcon, disabled: false },
    { id: 'cookies', label: 'Cookies', icon: CookieIcon, disabled: false },
  ] as const satisfies ReadonlyArray<{ id: SidebarTab; label: string; icon: typeof FileCode2Icon; disabled: boolean }>

  return (
    <aside className="flex h-full w-[84px] min-w-[84px] flex-col items-center border-r border-base-content/10 bg-base-100">
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = tab.id === sidebarTab

        return (
          <button
            key={tab.id}
            type="button"
            className={[
              'flex w-full flex-col items-center gap-2 px-1 py-3 text-center text-xs font-medium transition',
              tab.disabled ? 'cursor-not-allowed text-base-content/30' : '',
              !tab.disabled && isActive
                ? 'bg-primary/16 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-primary)_24%,transparent)]'
                : '',
              !tab.disabled && !isActive ? 'text-base-content/62 hover:bg-base-100/60 hover:text-base-content' : '',
            ].join(' ')}
            onPointerDown={() => {
              if (!tab.disabled) {
                EnvironmentCoordinator.setSidebarTab(tab.id)
              }
            }}
            disabled={tab.disabled}
            aria-current={isActive ? 'page' : undefined}
            title={tab.disabled ? `${tab.label} (coming soon)` : tab.label}
          >
            <Icon className="size-4" />
            <span className="leading-4">{tab.label}</span>
          </button>
        )
      })}
    </aside>
  )
}

function getRowDropTarget({
  draggedItem,
  itemMap,
  roots,
  node,
  event,
}: {
  draggedItem: Selection
  itemMap: Map<string, TreeNode>
  roots: TreeNode[]
  node: TreeNode
  event: DragEvent<HTMLDivElement>
}): ExplorerDropTarget | null {
  if (draggedItem.id === node.id && draggedItem.itemType === node.itemType) {
    return null
  }

  const rect = event.currentTarget.getBoundingClientRect()
  const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5

  if (draggedItem.itemType === 'example') {
    if (node.itemType === 'folder') {
      return null
    }

    const requestId = node.itemType === 'request' ? node.id : node.requestId
    const targetSiblings = getExampleSiblingNodes(itemMap, node).filter(
      sibling => !isSameSelection(sibling, draggedItem)
    )
    const anchorNode = node.itemType === 'request' ? null : node
    const targetIndex = anchorNode
      ? targetSiblings.findIndex(sibling => isSameSelection(sibling, anchorNode))
      : targetSiblings.length
    const nextPosition = anchorNode ? (ratio < 0.5 ? targetIndex : targetIndex + 1) : targetSiblings.length

    return {
      targetParentFolderId: null,
      targetRequestId: requestId,
      targetPosition: Math.max(0, nextPosition),
      placement: node.itemType === 'request' ? 'inside' : ratio < 0.5 ? 'before' : 'after',
      indicatorId: `${toSelectionKey(node)}:${node.itemType === 'request' ? 'inside' : ratio < 0.5 ? 'before' : 'after'}`,
    }
  }

  if (node.itemType === 'example') {
    return null
  }

  const placement: DropPlacement =
    node.itemType === 'folder' && ratio > 0.28 && ratio < 0.72 ? 'inside' : ratio < 0.5 ? 'before' : 'after'

  if (placement === 'inside') {
    if (draggedItem.itemType === 'folder' && isFolderAncestor(itemMap, draggedItem.id, node.id)) {
      return null
    }

    const children = node.children.filter(child => !isSameSelection(child, draggedItem))
    return {
      targetParentFolderId: node.id,
      targetRequestId: null,
      targetPosition: children.length,
      placement,
      indicatorId: `${toSelectionKey(node)}:${placement}`,
    }
  }

  const siblings = getSiblingNodes(roots, itemMap, node).filter(sibling => !isSameSelection(sibling, draggedItem))
  const targetIndex = siblings.findIndex(sibling => isSameSelection(sibling, node))
  if (targetIndex < 0) {
    return null
  }

  return {
    targetParentFolderId: node.parentFolderId,
    targetRequestId: null,
    targetPosition: placement === 'before' ? targetIndex : targetIndex + 1,
    placement,
    indicatorId: `${toSelectionKey(node)}:${placement}`,
  }
}

function getRootEndDropTarget(roots: TreeNode[], draggedItem: Selection): ExplorerDropTarget | null {
  if (draggedItem.itemType === 'example') {
    return null
  }

  return {
    targetParentFolderId: null,
    targetRequestId: null,
    targetPosition: roots.filter(root => !isSameSelection(root, draggedItem)).length,
    placement: 'after',
    indicatorId: 'root:end',
  }
}

function getSiblingNodes(roots: TreeNode[], itemMap: Map<string, TreeNode>, node: TreeNode) {
  if (node.itemType === 'example') {
    return getExampleSiblingNodes(itemMap, node)
  }

  if (node.itemType !== 'folder' && node.itemType !== 'request') {
    return roots
  }

  if (!node.parentFolderId) {
    return roots
  }

  return itemMap.get(`folder:${node.parentFolderId}`)?.children ?? roots
}

function getExampleSiblingNodes(itemMap: Map<string, TreeNode>, node: TreeNode) {
  const requestId = node.itemType === 'request' ? node.id : node.itemType === 'example' ? node.requestId : null
  if (!requestId) {
    return []
  }
  return itemMap.get(`request:${requestId}`)?.children.filter(child => child.itemType === 'example') ?? []
}

function isFolderAncestor(itemMap: Map<string, TreeNode>, folderId: string, candidateChildId: string) {
  let currentFolderId: string | null = candidateChildId

  while (currentFolderId) {
    if (currentFolderId === folderId) {
      return true
    }

    const current = itemMap.get(`folder:${currentFolderId}`)
    currentFolderId = current && current.itemType === 'folder' ? current.parentFolderId : null
  }

  return false
}

function isSameSelection(left: Selection | TreeNode | null, right: Selection | TreeNode | null) {
  if (!left || !right) {
    return left === right
  }

  return left.id === right.id && left.itemType === right.itemType
}

function isSameDropTarget(left: ExplorerDropTarget | null, right: ExplorerDropTarget | null) {
  if (!left || !right) {
    return left === right
  }

  return (
    left.targetParentFolderId === right.targetParentFolderId &&
    left.targetRequestId === right.targetRequestId &&
    left.targetPosition === right.targetPosition &&
    left.placement === right.placement &&
    left.indicatorId === right.indicatorId
  )
}
