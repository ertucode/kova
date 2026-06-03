import { useMemo, useState } from 'react'
import type { ExplorerItem } from '@common/Explorer'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, SearchIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { Dialog } from '@/lib/components/dialog'
import { RequestMethodTag } from './ExplorerRow'
import { captureFolderTreeSearchSnapshot, filterTreeWithDrafts } from './folderExplorerSearch'
import { buildTree, toSelectionKey } from './folderExplorerUtils'
import type { TreeNode } from './folderExplorerTypes'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { requestExecutionStore } from './requestExecutionStore'
import { tagsStore } from './tagsStore'

type SelectableTreeNode = Extract<TreeNode, { itemType: 'folder' | 'request' }>
type SelectableItemType = SelectableTreeNode['itemType']
type SelectableRequestType = Extract<SelectableTreeNode, { itemType: 'request' }>['requestType']

export function ExplorerItemPicker({
  items,
  selectedKeys,
  onChange,
  isMultiple,
  allowedItemTypes = ['folder', 'request'],
  allowedRequestTypes,
  searchPlaceholder = 'Search items',
  emptyText = 'No matching items.',
}: {
  items: ExplorerItem[]
  selectedKeys: string[]
  onChange: (selectedKeys: string[]) => void
  isMultiple: boolean
  allowedItemTypes?: SelectableItemType[]
  allowedRequestTypes?: SelectableRequestType[]
  searchPlaceholder?: string
  emptyText?: string
}) {
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const entries = useSelector(folderExplorerEditorStore, state => state.context.entries)
  const tagItems = useSelector(tagsStore, state => state.context.items)
  const tagAssignments = useSelector(tagsStore, state => state.context.assignments)
  const recentHttpRequestUsageCountByRequestId = useSelector(
    requestExecutionStore,
    state => state.context.recentHttpRequestUsageCountByRequestId
  )
  const recentHttpRequestUsageVersion = useSelector(requestExecutionStore, state => state.context.recentHttpRequestUsageVersion)
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const normalizedQuery = query.trim().toLowerCase()
  const filteredItems = useMemo(
    () =>
      items.filter((item): item is Extract<(typeof items)[number], { itemType: 'folder' | 'request' }> => {
        if (item.itemType === 'example') {
          return false
        }

        if (item.itemType === 'folder') {
          return true
        }

        if (!allowedItemTypes.includes(item.itemType)) {
          return false
        }

        if (item.itemType === 'request' && allowedRequestTypes && !allowedRequestTypes.includes(item.requestType)) {
          return false
        }

        return true
      }),
    [allowedItemTypes, allowedRequestTypes, items]
  )
  const { roots } = useMemo(() => buildTree(filteredItems), [filteredItems])
  const searchSnapshot = useMemo(
    () =>
      captureFolderTreeSearchSnapshot({
        items: filteredItems,
        roots,
        entries,
        tagItems,
        tagAssignments,
        recentHttpRequestUsageCountByRequestId,
        recentHttpRequestUsageVersion,
      }),
    [entries, filteredItems, recentHttpRequestUsageCountByRequestId, recentHttpRequestUsageVersion, roots, tagAssignments, tagItems]
  )
  const visibleRoots = useMemo(
    () =>
      pruneTreeForSelection(
        filterTreeWithDrafts(
          searchSnapshot.roots,
          normalizedQuery,
          searchSnapshot.entries,
          searchSnapshot.tagNamesBySelection,
          searchSnapshot.recentHttpRequestUsageCountByRequestId,
          searchSnapshot.recentHttpRequestUsageVersion
        ) as SelectableTreeNode[],
        allowedItemTypes,
        allowedRequestTypes
      ),
    [allowedItemTypes, allowedRequestTypes, normalizedQuery, searchSnapshot]
  )

  const toggleExpanded = (id: string) => {
    setExpandedIds(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]))
  }

  const toggleSelected = (key: string, checked: boolean) => {
    onChange(
      isMultiple
        ? checked
          ? [...selectedKeys, key]
          : selectedKeys.filter(value => value !== key)
        : checked
          ? [key]
          : []
    )
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 rounded-2xl bg-base-200/45 px-3 py-2.5 text-sm text-base-content/60">
        <SearchIcon className="size-4 shrink-0" />
        <input
          type="text"
          className="w-full bg-transparent outline-none placeholder:text-base-content/35"
          placeholder={searchPlaceholder}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </label>
      <div className="h-[420px] overflow-auto">
        {visibleRoots.length === 0 ? <p className="px-1 py-2 text-sm text-base-content/45">{emptyText}</p> : null}
        <div className="space-y-1">
          {visibleRoots.map(node => (
            <ExplorerItemTreeRow
              key={toSelectionKey(node)}
              node={node}
              depth={0}
              forceExpanded={normalizedQuery.length > 0}
              expandedIds={expandedIds}
              selectedKeySet={selectedKeySet}
              isMultiple={isMultiple}
              allowedItemTypes={allowedItemTypes}
              allowedRequestTypes={allowedRequestTypes}
              onToggleExpanded={toggleExpanded}
              onToggleSelected={toggleSelected}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function ExplorerItemPickerInput({
  items,
  selectedKeys,
  onChange,
  isMultiple,
  title,
  description,
  buttonLabel,
  emptySelectionLabel,
  allowedItemTypes = ['folder', 'request'],
  allowedRequestTypes,
  triggerClassName = 'h-9 w-full rounded-none border border-base-content/10 bg-base-100/70 px-3 text-left text-xs font-medium text-base-content/80',
}: {
  items: ExplorerItem[]
  selectedKeys: string[]
  onChange: (selectedKeys: string[]) => void
  isMultiple: boolean
  title: string
  description?: string
  buttonLabel: string
  emptySelectionLabel: string
  allowedItemTypes?: SelectableItemType[]
  allowedRequestTypes?: SelectableRequestType[]
  triggerClassName?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftSelectedKeys, setDraftSelectedKeys] = useState(selectedKeys)
  const itemMap = useMemo(
    () => new Map(items.map(item => [toSelectionKey(item), item] satisfies [string, ExplorerItem])),
    [items]
  )

  const selectionLabel = useMemo(() => {
    if (selectedKeys.length === 0) {
      return emptySelectionLabel
    }

    const names = selectedKeys.flatMap(key => {
      const item = itemMap.get(key)
      return item && item.itemType !== 'example' ? [buildExplorerItemPath(itemMap, item)] : []
    })

    if (names.length === 0) {
      return emptySelectionLabel
    }

    return isMultiple ? `${names.length} selected` : names[0]
  }, [emptySelectionLabel, isMultiple, itemMap, selectedKeys])

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          setDraftSelectedKeys(selectedKeys)
          setIsOpen(true)
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="truncate">{selectionLabel}</span>
          <span className="shrink-0 text-[0.7rem] uppercase tracking-[0.08em] text-base-content/45">{buttonLabel}</span>
        </div>
      </button>

      {isOpen ? (
        <Dialog
          title={title}
          onClose={() => setIsOpen(false)}
          className="max-w-[720px]"
          footer={
            isMultiple ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setIsOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    onChange(draftSelectedKeys)
                    setIsOpen(false)
                  }}
                >
                  Save
                </button>
              </>
            ) : undefined
          }
        >
          <div className="space-y-4">
            {description ? <p className="text-sm text-base-content/60">{description}</p> : null}
            <ExplorerItemPicker
              items={items}
              selectedKeys={draftSelectedKeys}
              onChange={nextSelectedKeys => {
                if (isMultiple) {
                  setDraftSelectedKeys(nextSelectedKeys)
                  return
                }

                onChange(nextSelectedKeys)
                setDraftSelectedKeys(nextSelectedKeys)
                setIsOpen(false)
              }}
              isMultiple={isMultiple}
              allowedItemTypes={allowedItemTypes}
              allowedRequestTypes={allowedRequestTypes}
            />
          </div>
        </Dialog>
      ) : null}
    </>
  )
}

function ExplorerItemTreeRow({
  node,
  depth,
  forceExpanded,
  expandedIds,
  selectedKeySet,
  isMultiple,
  allowedItemTypes,
  allowedRequestTypes,
  onToggleExpanded,
  onToggleSelected,
}: {
  node: SelectableTreeNode
  depth: number
  forceExpanded: boolean
  expandedIds: string[]
  selectedKeySet: Set<string>
  isMultiple: boolean
  allowedItemTypes: SelectableItemType[]
  allowedRequestTypes?: SelectableRequestType[]
  onToggleExpanded: (id: string) => void
  onToggleSelected: (key: string, checked: boolean) => void
}) {
  const key = toSelectionKey(node)
  const checked = selectedKeySet.has(key)
  const hasChildren = node.itemType === 'folder' && node.children.length > 0
  const isExpanded = forceExpanded || expandedIds.includes(node.id)
  const isSelectable = isNodeSelectable(node, allowedItemTypes, allowedRequestTypes)

  const handleSelect = () => {
    if (!isSelectable) {
      return
    }

    onToggleSelected(key, !checked || !isMultiple)
  }

  return (
    <div>
      <label
        className={[
          'flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2.5 transition',
          checked ? 'bg-primary/10 text-base-content' : 'bg-base-200/40 text-base-content/78 hover:bg-base-200/65',
        ].join(' ')}
        style={{ paddingLeft: 12 + depth * 18 }}
        onClick={event => {
          const target = event.target as HTMLElement
          if (target.closest('button')) {
            return
          }

          handleSelect()
        }}
      >
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center text-base-content/45"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            if (hasChildren) {
              onToggleExpanded(node.id)
            }
          }}
          aria-label={isExpanded ? 'Collapse item' : 'Expand item'}
          disabled={!hasChildren}
        >
          {hasChildren ? isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" /> : <span className="size-4" />}
        </button>
        {isMultiple ? (
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={checked}
            disabled={!isSelectable}
            onChange={event => onToggleSelected(key, event.target.checked)}
            onClick={event => event.stopPropagation()}
          />
        ) : null}
        {node.itemType === 'folder' ? (
          <FolderIcon className="size-4 shrink-0 text-base-content/55" />
        ) : (
          <RequestMethodTag method={node.method} requestType={node.requestType} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        {node.itemType === 'request' ? <span className="max-w-[220px] truncate text-xs text-base-content/45">{node.url}</span> : null}
      </label>

      {hasChildren && isExpanded ? (
        <div className="mt-1 space-y-1">
          {node.children.map(child => (
            <ExplorerItemTreeRow
              key={toSelectionKey(child)}
              node={child as SelectableTreeNode}
              depth={depth + 1}
              forceExpanded={forceExpanded}
              expandedIds={expandedIds}
              selectedKeySet={selectedKeySet}
              isMultiple={isMultiple}
              allowedItemTypes={allowedItemTypes}
              allowedRequestTypes={allowedRequestTypes}
              onToggleExpanded={onToggleExpanded}
              onToggleSelected={onToggleSelected}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildExplorerItemPath(itemMap: Map<string, ExplorerItem>, item: Extract<ExplorerItem, { itemType: 'folder' | 'request' }>) {
  return [...getFolderPathSegments(itemMap, item.parentFolderId), item.name].join(' / ')
}

function getFolderPathSegments(itemMap: Map<string, ExplorerItem>, parentFolderId: string | null) {
  const segments: string[] = []
  let currentFolderId = parentFolderId

  while (currentFolderId) {
    const folder = itemMap.get(`folder:${currentFolderId}`)
    if (!folder || folder.itemType !== 'folder') {
      break
    }

    segments.unshift(folder.name)
    currentFolderId = folder.parentFolderId
  }

  return segments
}

function isNodeSelectable(
  node: SelectableTreeNode,
  allowedItemTypes: SelectableItemType[],
  allowedRequestTypes?: SelectableRequestType[]
) {
  if (!allowedItemTypes.includes(node.itemType)) {
    return false
  }

  if (node.itemType === 'request' && allowedRequestTypes) {
    return allowedRequestTypes.includes(node.requestType)
  }

  return true
}

function pruneTreeForSelection(
  nodes: SelectableTreeNode[],
  allowedItemTypes: SelectableItemType[],
  allowedRequestTypes?: SelectableRequestType[]
): SelectableTreeNode[] {
  return nodes.flatMap(node => {
    const children = node.itemType === 'folder' ? pruneTreeForSelection(node.children as SelectableTreeNode[], allowedItemTypes, allowedRequestTypes) : []
    const nextNode = children.length > 0 ? { ...node, children } : node
    const keepNode = isNodeSelectable(node, allowedItemTypes, allowedRequestTypes) || children.length > 0

    return keepNode ? [nextNode] : []
  })
}
