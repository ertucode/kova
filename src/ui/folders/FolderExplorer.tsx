import { useEffect, useMemo } from 'react'
import { useSelector } from '@xstate/store/react'
import { FileCode2Icon, FolderIcon, SearchIcon } from 'lucide-react'
import { DetailsPanel } from './DetailsPanel'
import { DraftRow, EmptyState, ExplorerRow } from './ExplorerRow'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { buildTree, filterTree } from './folderExplorerUtils'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'

export function FolderExplorer() {
  const items = useSelector(folderExplorerTreeStore, state => state.context.items)
  const searchQuery = useSelector(folderExplorerTreeStore, state => state.context.searchQuery)
  const createDraft = useSelector(folderExplorerTreeStore, state => state.context.createDraft)

  useEffect(() => {
    void FolderExplorerCoordinator.loadItems()
  }, [])

  const { roots } = useMemo(() => buildTree(items), [items])
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleRoots = useMemo(() => filterTree(roots, normalizedSearch), [roots, normalizedSearch])

  return (
    <div className="flex min-h-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--color-base-200)_86%,black)_0%,color-mix(in_oklch,var(--color-base-100)_94%,black)_100%)]">
        <div className="border-b border-base-content/10 px-4 py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-100/70 text-base-content transition hover:border-base-content/20 hover:bg-base-100"
              onClick={() => FolderExplorerCoordinator.startCreate('folder', null)}
              aria-label="Add folder"
              title="Add folder"
            >
              <FolderIcon className="size-4" />
            </button>

            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-100/70 text-base-content transition hover:border-base-content/20 hover:bg-base-100"
              onClick={() => FolderExplorerCoordinator.startCreate('request', null)}
              aria-label="Add request"
              title="Add request"
            >
              <FileCode2Icon className="size-4" />
            </button>

            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content/60 focus-within:border-base-content/25 focus-within:bg-base-100">
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
                <ExplorerRow key={`${node.itemType}:${node.id}`} node={node} depth={0} forceExpanded={normalizedSearch.length > 0} />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-base-100">
        <DetailsPanel />
      </main>
    </div>
  )
}
