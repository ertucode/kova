import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useSelector } from '@xstate/store/react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileCode2Icon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { ExplorerItem } from '@common/Explorer'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { ExplorerDropTarget, Selection, TreeNode } from './folderExplorerTypes'
import { toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore, isEntryDirty } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'

export function ExplorerRow({
  node,
  depth,
  forceExpanded,
  canDrag,
  draggedItem,
  dropTarget,
  onDragStart,
  onDragEnd,
  onRowDragOver,
  onRowDrop,
}: {
  node: TreeNode
  depth: number
  forceExpanded: boolean
  canDrag: boolean
  draggedItem: Selection | null
  dropTarget: ExplorerDropTarget | null
  onDragStart: (node: TreeNode, event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onRowDragOver: (node: TreeNode, event: DragEvent<HTMLDivElement>) => void
  onRowDrop: (node: TreeNode, event: DragEvent<HTMLDivElement>) => void
}) {
  const expandedIds = useSelector(folderExplorerEditorStore, state => state.context.expandedIds)
  const createDraft = useSelector(folderExplorerTreeStore, state => state.context.createDraft)
  const selected = useSelector(folderExplorerEditorStore, state => state.context.selected)
  const isRequestDirty = useSelector(folderExplorerEditorStore, state => {
    const entry = state.context.entries[`request:${node.id}`]
    if (node.itemType !== 'request' || !entry?.current) {
      return false
    }

    return isEntryDirty(entry)
  })

  const hasChildren = node.itemType === 'folder' && node.children.length > 0
  const isExpanded = forceExpanded || expandedIds.includes(node.id)
  const isSelected = selected?.id === node.id && selected.itemType === node.itemType
  const isCreateOpen = createDraft?.parentFolderId === node.id
  const rowKey = toSelectionKey(node)
  const isDragged = draggedItem?.id === node.id && draggedItem.itemType === node.itemType
  const showDropBefore = dropTarget?.indicatorId === `${rowKey}:before`
  const showDropAfter = dropTarget?.indicatorId === `${rowKey}:after`
  const showDropInside = dropTarget?.indicatorId === `${rowKey}:inside`

  return (
    <div className="relative">
      {showDropBefore ? <div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 bg-primary" /> : null}
      <div
        className={[
          'group flex h-8 items-center gap-1 border pr-1 transition',
          isSelected
            ? 'border-base-content/10 bg-base-100/95 shadow-[0_10px_28px_rgba(0,0,0,0.12)]'
            : 'border-transparent hover:border-base-content/8 hover:bg-base-100/55',
          canDrag ? 'cursor-grab active:cursor-grabbing' : '',
          isDragged ? 'opacity-45' : '',
          showDropInside ? 'border-primary/50 bg-primary/8' : '',
        ].join(' ')}
        style={{ paddingLeft: depth * 18 }}
        draggable={canDrag}
        onPointerDown={event => {
          if (event.button !== 0) {
            return
          }

          FolderExplorerCoordinator.selectItem({ itemType: node.itemType, id: node.id })
        }}
        onDragStart={event => onDragStart(node, event)}
        onDragEnd={onDragEnd}
        onDragOver={event => onRowDragOver(node, event)}
        onDrop={event => void onRowDrop(node, event)}
      >
        <button
          type="button"
          draggable={false}
          className="flex size-7 shrink-0 items-center justify-center text-base-content/45 transition hover:bg-base-200/80 hover:text-base-content disabled:cursor-default disabled:hover:bg-transparent"
          onClick={event => {
            event.stopPropagation()
            if (node.itemType === 'folder' && hasChildren) {
              FolderExplorerCoordinator.toggleExpanded(node.id)
            }
          }}
          aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          disabled={node.itemType !== 'folder' || !hasChildren}
        >
          {node.itemType === 'folder' && hasChildren ? (
            isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />
          ) : (
            <span className="size-4" />
          )}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {node.itemType === 'folder' ? (
            <FolderIcon className="size-4 shrink-0 text-base-content/55" />
          ) : (
            <FileCode2Icon className="size-4 shrink-0 text-base-content/55" />
          )}
          <div className="min-w-0 flex-1 truncate px-1 text-sm text-base-content">{node.name}</div>
          {isRequestDirty ? (
            <div
              className="size-2 shrink-0 rounded-full bg-warning"
              aria-label="Request has unsaved changes"
              title="Request has unsaved changes"
            />
          ) : null}
        </div>

        <ExplorerMenu
          itemType={node.itemType}
          onAddFolder={node.itemType === 'folder' ? () => FolderExplorerCoordinator.startCreate('folder', node.id) : undefined}
          onAddRequest={node.itemType === 'folder' ? () => FolderExplorerCoordinator.startCreate('request', node.id) : undefined}
          onDelete={() => FolderExplorerCoordinator.requestDelete(node)}
        />
      </div>

      {isCreateOpen ? (
        <DraftRow
          value={createDraft.name}
          depth={depth + 1}
          icon={createDraft.itemType}
          onChange={FolderExplorerCoordinator.changeCreateName}
          onSubmit={() => void FolderExplorerCoordinator.submitCreate()}
          onCancel={FolderExplorerCoordinator.cancelCreate}
        />
      ) : null}

      {node.itemType === 'folder' && hasChildren && isExpanded ? (
        <div>
          {node.children.map(child => (
            <ExplorerRow
              key={toSelectionKey(child)}
              node={child}
              depth={depth + 1}
              forceExpanded={forceExpanded}
              canDrag={canDrag}
              draggedItem={draggedItem}
              dropTarget={dropTarget}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onRowDragOver={onRowDragOver}
              onRowDrop={onRowDrop}
            />
          ))}
        </div>
      ) : null}

      {showDropAfter ? <div className="pointer-events-none absolute inset-x-3 bottom-0 z-10 h-0.5 bg-primary" /> : null}
    </div>
  )
}

export function DraftRow({
  value,
  depth,
  icon,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  depth: number
  icon: ExplorerItem['itemType']
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="py-1" style={{ paddingLeft: depth * 18 }}>
      <div className="flex items-center gap-2 border border-base-content/10 bg-base-100/90 px-2 pr-1">
        {icon === 'folder' ? <FolderIcon className="size-4 text-base-content/55" /> : <FileCode2Icon className="size-4 text-base-content/55" />}
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-base-content/35"
          value={value}
          onChange={event => onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }}
        />
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center text-base-content/45 transition hover:bg-base-200/80 hover:text-base-content"
          onClick={onCancel}
          aria-label="Cancel new item"
          title="Cancel"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-4 rounded-[24px] border border-dashed border-base-content/12 bg-base-100/35 px-5 py-8 text-center">
      <div className="text-sm font-medium text-base-content">{title}</div>
      <div className="mt-1 text-sm text-base-content/50">{description}</div>
    </div>
  )
}

function ExplorerMenu({
  itemType,
  onAddFolder,
  onAddRequest,
  onDelete,
}: {
  itemType: ExplorerItem['itemType']
  onAddFolder?: () => void
  onAddRequest?: () => void
  onDelete: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

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
    <div ref={containerRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        title="Item actions"
        aria-label="Item actions"
        draggable={false}
        className="flex size-7 items-center justify-center text-base-content/45 opacity-0 transition hover:bg-base-200/80 hover:text-base-content group-hover:opacity-100 focus:opacity-100"
        onClick={event => {
          event.stopPropagation()
          setIsOpen(prev => !prev)
        }}
      >
        <MoreHorizontalIcon className="size-4" />
      </button>

      {isOpen ? (
        <ul className="menu absolute right-0 top-full z-20 mt-1 w-44 border border-base-content/10 bg-base-100 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
          {itemType === 'folder' && onAddFolder ? (
            <li>
              <button type="button" onClick={() => runAction(onAddFolder)}>
                <FolderIcon className="size-4" />
                Add Folder
              </button>
            </li>
          ) : null}
          {itemType === 'folder' && onAddRequest ? (
            <li>
              <button type="button" onClick={() => runAction(onAddRequest)}>
                <PlusIcon className="size-4" />
                Add Request
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" onClick={() => runAction(onDelete)} className="text-error hover:text-error">
              <Trash2Icon className="size-4" />
              Delete
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  )
}
