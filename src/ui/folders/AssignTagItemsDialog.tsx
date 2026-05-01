import { useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import type { TaggableItemType } from '@common/Tags'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, SearchIcon } from 'lucide-react'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { RequestMethodTag } from './ExplorerRow'
import { buildTree, filterTreeWithDrafts, toSelectionKey } from './folderExplorerUtils'
import { TagsCoordinator } from './tagsCoordinator'
import { tagsStore } from './tagsStore'
import type { TreeNode } from './folderExplorerTypes'

type TagTreeNode = Extract<TreeNode, { itemType: 'folder' | 'request' }>

export function AssignTagItemsDialog({ tagId, tagName }: { tagId: string; tagName: string }) {
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const assignments = useSelector(tagsStore, state => state.context.assignments)
  const [query, setQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const items = useMemo(
    () => explorerItems.filter((item): item is Extract<(typeof explorerItems)[number], { itemType: 'folder' | 'request' }> => item.itemType !== 'example'),
    [explorerItems]
  )
  const [selectedKeys, setSelectedKeys] = useState(() =>
    assignments.filter(assignment => assignment.tagId === tagId).map(assignment => `${assignment.itemType}:${assignment.itemId}`)
  )

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
  const normalizedQuery = query.trim().toLowerCase()
  const { roots } = useMemo(() => buildTree(items), [items])
  const visibleRoots = useMemo(() => filterTreeWithDrafts(roots, normalizedQuery) as TagTreeNode[], [normalizedQuery, roots])
  const [expandedIds, setExpandedIds] = useState<string[]>([])

  const toggleExpanded = (id: string) => {
    setExpandedIds(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]))
  }

  const save = async () => {
    setIsSaving(true)
    const nextItems = selectedKeys.map(key => {
      const [itemType, itemId] = key.split(':')
      return { itemType: itemType as TaggableItemType, itemId }
    })
    const success = await TagsCoordinator.replaceTagItems(tagId, nextItems)
    setIsSaving(false)
    if (success) {
      dialogActions.close()
    }
  }

  return (
    <Dialog
      title="Assign Items"
      onClose={() => dialogActions.close()}
      className="max-w-[720px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-base-content/60">Choose folders and requests for {tagName}.</p>
        <label className="flex items-center gap-2 rounded-2xl bg-base-200/45 px-3 py-2.5 text-sm text-base-content/60">
          <SearchIcon className="size-4 shrink-0" />
          <input
            type="text"
            className="w-full bg-transparent outline-none placeholder:text-base-content/35"
            placeholder="Search items"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <div className="max-h-[420px] overflow-auto">
          {visibleRoots.length === 0 ? <p className="px-1 py-2 text-sm text-base-content/45">No matching items.</p> : null}
          <div className="space-y-1">
            {visibleRoots.map(node => (
              <TagItemTreeRow
                key={toSelectionKey(node)}
                node={node}
                depth={0}
                forceExpanded={normalizedQuery.length > 0}
                expandedIds={expandedIds}
                selectedKeySet={selectedKeySet}
                onToggleExpanded={toggleExpanded}
                onToggleSelected={(key, checked) =>
                  setSelectedKeys(current => (checked ? [...current, key] : current.filter(value => value !== key)))
                }
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function TagItemTreeRow({
  node,
  depth,
  forceExpanded,
  expandedIds,
  selectedKeySet,
  onToggleExpanded,
  onToggleSelected,
}: {
  node: TagTreeNode
  depth: number
  forceExpanded: boolean
  expandedIds: string[]
  selectedKeySet: Set<string>
  onToggleExpanded: (id: string) => void
  onToggleSelected: (key: string, checked: boolean) => void
}) {
  const key = toSelectionKey(node)
  const checked = selectedKeySet.has(key)
  const hasChildren = node.itemType === 'folder' && node.children.length > 0
  const isExpanded = forceExpanded || expandedIds.includes(node.id)

  return (
    <div>
      <label
        className={[
          'flex cursor-pointer items-center gap-2 rounded-2xl px-3 py-2.5 transition',
          checked ? 'bg-primary/10 text-base-content' : 'bg-base-200/40 text-base-content/78 hover:bg-base-200/65',
        ].join(' ')}
        style={{ paddingLeft: 12 + depth * 18 }}
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
          {hasChildren ? (
            isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />
          ) : (
            <span className="size-4" />
          )}
        </button>
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={checked}
          onChange={event => onToggleSelected(key, event.target.checked)}
        />
        {node.itemType === 'folder' ? (
          <FolderIcon className="size-4 shrink-0 text-base-content/55" />
        ) : (
          <RequestMethodTag method={node.method} requestType={node.requestType} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
        {node.itemType === 'request' ? (
          <span className="max-w-[220px] truncate text-xs text-base-content/45">{node.url}</span>
        ) : null}
      </label>

      {hasChildren && isExpanded ? (
        <div className="mt-1 space-y-1">
          {node.children.map(child => (
            <TagItemTreeRow
              key={toSelectionKey(child)}
              node={child as TagTreeNode}
              depth={depth + 1}
              forceExpanded={forceExpanded}
              expandedIds={expandedIds}
              selectedKeySet={selectedKeySet}
              onToggleExpanded={onToggleExpanded}
              onToggleSelected={onToggleSelected}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
