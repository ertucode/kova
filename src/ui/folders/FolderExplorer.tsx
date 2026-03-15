import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useSelector } from '@xstate/store/react'
import { Clock3Icon, FileCode2Icon, FileJsonIcon, FlaskConicalIcon, FolderIcon, MoreHorizontalIcon, SearchIcon } from 'lucide-react'
import type { ExplorerDropTarget, Selection, TreeNode } from './folderExplorerTypes'
import { DetailsPanel } from './DetailsPanel'
import { FolderExplorerTabs } from './FolderExplorerTabs'
import { DraftRow, EmptyState, ExplorerRow } from './ExplorerRow'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { EnvironmentsPanel } from './EnvironmentsPanel'
import { HistoryPanel } from './RequestExecutionPanels'
import { buildTree, filterTree, toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore, type SidebarTab } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { dialogActions } from '@/global/dialogStore'
import { PostmanEnvironmentImportDialog } from './PostmanEnvironmentImportDialog'
import { PostmanImportDialog } from './PostmanImportDialog'
import { PostmanExportDialog } from './PostmanExportDialog'

type DropPlacement = ExplorerDropTarget['placement']

export function FolderExplorer() {
  const items = useSelector(folderExplorerTreeStore, state => state.context.items)
  const searchQuery = useSelector(folderExplorerTreeStore, state => state.context.searchQuery)
  const createDraft = useSelector(folderExplorerTreeStore, state => state.context.createDraft)
  const sidebarTab = useSelector(folderExplorerEditorStore, state => state.context.sidebarTab)
  const [draggedItem, setDraggedItem] = useState<Selection | null>(null)
  const [dropTarget, setDropTarget] = useState<ExplorerDropTarget | null>(null)

  useEffect(() => {
    void FolderExplorerCoordinator.initialize()
    void EnvironmentCoordinator.loadEnvironments()
  }, [])

  const { roots, itemMap } = useMemo(() => buildTree(items), [items])
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleRoots = useMemo(() => filterTree(roots, normalizedSearch), [roots, normalizedSearch])
  const canDrag = normalizedSearch.length === 0 && createDraft === null

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
        ? { itemType: 'example', id: itemToMove.id, targetRequestId: nextDropTarget.targetRequestId ?? '', targetPosition: nextDropTarget.targetPosition }
        : { itemType: itemToMove.itemType, id: itemToMove.id, targetParentFolderId: nextDropTarget.targetParentFolderId, targetPosition: nextDropTarget.targetPosition }
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
                  type="text"
                  className="w-full bg-transparent outline-none placeholder:text-base-content/35"
                  placeholder="Search folders and requests"
                  value={searchQuery}
                  onChange={event => FolderExplorerCoordinator.updateTreeSearchQuery(event.target.value)}
                />
              </label>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto py-3">
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
                    forceExpanded={normalizedSearch.length > 0}
                    canDrag={canDrag}
                    draggedItem={draggedItem}
                    dropTarget={dropTarget}
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
                    {dropTarget?.indicatorId === 'root:end' ? <div className="translate-y-[9px] border-t border-primary" /> : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </aside>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col bg-base-100">
        {sidebarTab === 'requests' ? <FolderExplorerTabs /> : null}
        {sidebarTab === 'requests' ? <DetailsPanel /> : null}
        {sidebarTab === 'environments' ? <EnvironmentsPanel /> : null}
        {sidebarTab === 'history' ? <HistoryPanel /> : null}
      </main>
    </div>
  )
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
            <button type="button" onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('folder', null))}>
              <FolderIcon className="size-4" />
              Add Folder
            </button>
          </li>
            <li>
              <button type="button" onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('request', null, 'http'))}>
                <FileCode2Icon className="size-4" />
                Add HTTP Request
              </button>
            </li>
            <li>
              <button type="button" onClick={() => runAction(() => FolderExplorerCoordinator.startCreate('request', null, 'websocket'))}>
                <FileCode2Icon className="size-4" />
                Add WebSocket
              </button>
            </li>
          <li>
            <button type="button" onClick={() => runAction(() => dialogActions.open({ component: PostmanExportDialog, props: { scope: 'workspace' } }))}>
              <FileJsonIcon className="size-4" />
              Export Postman
            </button>
          </li>
          <li>
            <button type="button" onClick={() => runAction(() => dialogActions.open({ component: PostmanImportDialog, props: {} }))}>
              <FileCode2Icon className="size-4" />
              Import Postman
            </button>
          </li>
          <li>
            <button type="button" onClick={() => runAction(() => dialogActions.open({ component: PostmanEnvironmentImportDialog, props: {} }))}>
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
    { id: 'history', label: 'History', icon: Clock3Icon, disabled: false },
  ] as const satisfies ReadonlyArray<{ id: SidebarTab; label: string; icon: typeof FileCode2Icon; disabled: boolean }>

  return (
    <aside className="flex h-full w-[84px] min-w-[84px] flex-col items-center gap-3 border-r border-base-content/10 bg-base-100 px-3 py-4">
      {tabs.map(tab => {
        const Icon = tab.icon
        const isActive = tab.id === sidebarTab

        return (
          <button
            key={tab.id}
            type="button"
            className={[
              'flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center text-xs font-medium transition',
              tab.disabled ? 'cursor-not-allowed text-base-content/30' : '',
              !tab.disabled && isActive ? 'bg-primary/16 text-primary shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-primary)_24%,transparent)]' : '',
              !tab.disabled && !isActive ? 'text-base-content/62 hover:bg-base-100/60 hover:text-base-content' : '',
            ].join(' ')}
            onClick={() => {
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
    const targetSiblings = getExampleSiblingNodes(itemMap, node).filter(sibling => !isSameSelection(sibling, draggedItem))
    const anchorNode = node.itemType === 'request' ? null : node
    const targetIndex = anchorNode ? targetSiblings.findIndex(sibling => isSameSelection(sibling, anchorNode)) : targetSiblings.length
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

  const placement: DropPlacement = node.itemType === 'folder' && ratio > 0.28 && ratio < 0.72 ? 'inside' : ratio < 0.5 ? 'before' : 'after'

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
