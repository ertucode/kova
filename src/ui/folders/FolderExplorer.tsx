import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
  Trash2Icon,
} from 'lucide-react'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import type { FolderRecord } from '@common/Folders'

type TreeNode = FolderRecord & {
  children: TreeNode[]
}

type DraftState = {
  parentId: string | null
  name: string
}

export function FolderExplorer() {
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [createDraft, setCreateDraft] = useState<DraftState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  const loadFolders = useCallback(async () => {
    try {
      const nextFolders = await getWindowElectron().listFolders()
      setFolders(nextFolders)

      setExpandedIds(prev => {
        const validIds = new Set(nextFolders.map(folder => folder.id))
        const next = new Set([...prev].filter(id => validIds.has(id)))

        if (next.size === 0) {
          nextFolders.forEach(folder => {
            if (folder.parentId === null) {
              next.add(folder.id)
            }
          })
        }

        return next
      })

      setSelectedId(prev => {
        if (prev && nextFolders.some(folder => folder.id === prev)) {
          return prev
        }
        return nextFolders[0]?.id ?? null
      })
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load folders',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const { roots, folderMap } = useMemo(() => buildTree(folders), [folders])
  const selectedFolder = selectedId ? folderMap.get(selectedId) ?? null : null
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const hasSearch = normalizedSearch.length > 0

  const visibleRoots = useMemo(
    () => filterTree(roots, normalizedSearch),
    [roots, normalizedSearch]
  )

  const setExpanded = useCallback((id: string, value: boolean) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (value) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const startCreate = useCallback(
    (parentId: string | null) => {
      setEditingId(null)
      setEditingName('')
      setCreateDraft({ parentId, name: '' })
      if (parentId) {
        setExpanded(parentId, true)
        setSelectedId(parentId)
      }
    },
    [setExpanded]
  )

  const cancelCreate = useCallback(() => {
    setCreateDraft(null)
  }, [])

  const submitCreate = useCallback(async () => {
    if (!createDraft) return

    const result = await getWindowElectron().createFolder(createDraft)
    if (!result.success) {
      toast.show(result)
      return
    }

    setCreateDraft(null)
    if (createDraft.parentId) {
      setExpanded(createDraft.parentId, true)
    }
    await loadFolders()
    setSelectedId(result.data.id)
  }, [createDraft, loadFolders, setExpanded])

  const startRename = useCallback((folder: FolderRecord) => {
    setCreateDraft(null)
    setEditingId(folder.id)
    setEditingName(folder.name)
    setSelectedId(folder.id)
  }, [])

  const cancelRename = useCallback(() => {
    setEditingId(null)
    setEditingName('')
  }, [])

  const submitRename = useCallback(async () => {
    if (!editingId) return

    const result = await getWindowElectron().renameFolder({ id: editingId, name: editingName })
    if (!result.success) {
      toast.show(result)
      return
    }

    setEditingId(null)
    setEditingName('')
    await loadFolders()
  }, [editingId, editingName, loadFolders])

  const deleteFolder = useCallback(
    (folder: FolderRecord) => {
      confirmation.trigger.confirm({
        title: 'Delete folder?',
        message: `"${folder.name}" and all nested folders will be deleted.`,
        confirmText: 'Delete',
        onConfirm: async () => {
          const result = await getWindowElectron().deleteFolder({ id: folder.id })
          if (!result.success) {
            toast.show(result)
            return
          }

          if (editingId === folder.id) {
            cancelRename()
          }
          if (createDraft?.parentId === folder.id) {
            cancelCreate()
          }
          await loadFolders()
        },
      })
    },
    [cancelCreate, cancelRename, createDraft?.parentId, editingId, loadFolders]
  )

  return (
    <div className="flex min-h-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--color-base-200)_86%,black)_0%,color-mix(in_oklch,var(--color-base-100)_94%,black)_100%)]">
        <div className="border-b border-base-content/10 px-4 py-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-base-content/45">Folders</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-100/70 text-base-content transition hover:border-base-content/20 hover:bg-base-100"
              onClick={() => startCreate(null)}
              aria-label="Add folder"
              title="Add folder"
            >
              <PlusIcon className="size-4" />
            </button>

            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content/60 focus-within:border-base-content/25 focus-within:bg-base-100">
              <SearchIcon className="size-4 shrink-0" />
              <input
                type="text"
                className="w-full bg-transparent outline-none placeholder:text-base-content/35"
                placeholder="Search folders"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto py-3">
          {createDraft?.parentId === null ? (
            <DraftRow
              value={createDraft.name}
              depth={0}
              onChange={value => setCreateDraft({ parentId: null, name: value })}
              onSubmit={() => void submitCreate()}
              onCancel={cancelCreate}
            />
          ) : null}

          {folders.length === 0 ? (
            <EmptyState title="No folders yet" description="Create your first folder to get started." />
          ) : visibleRoots.length === 0 ? (
            <EmptyState title="No matches" description="Try a different folder name." />
          ) : (
            <div className="space-y-0.5">
              {visibleRoots.map(node => (
                <FolderRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expandedIds={expandedIds}
                  selectedId={selectedId}
                  editingId={editingId}
                  editingName={editingName}
                  createDraft={createDraft}
                  forceExpanded={hasSearch}
                  onSelect={setSelectedId}
                  onToggleExpanded={id => setExpanded(id, !expandedIds.has(id))}
                  onRenameChange={setEditingName}
                  onSubmitRename={() => void submitRename()}
                  onCancelRename={cancelRename}
                  onStartRename={startRename}
                  onStartCreate={startCreate}
                  onCreateNameChange={value => setCreateDraft(prev => (prev ? { ...prev, name: value } : prev))}
                  onSubmitCreate={() => void submitCreate()}
                  onCancelCreate={cancelCreate}
                  onDelete={deleteFolder}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--color-primary)_14%,transparent),transparent_34%),linear-gradient(180deg,color-mix(in_oklch,var(--color-base-100)_96%,white)_0%,color-mix(in_oklch,var(--color-base-100)_90%,black)_100%)] px-8 py-10">
        <div className="w-full max-w-3xl rounded-[28px] border border-base-content/10 bg-base-100/60 px-8 py-10 shadow-[0_24px_80px_rgba(0,0,0,0.22)] backdrop-blur-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-base-content/40">Selected Folder</div>
          <div className="mt-4 text-4xl font-semibold tracking-tight text-base-content">
            {selectedFolder?.name ?? 'Choose a folder'}
          </div>
        </div>
      </main>
    </div>
  )
}

function FolderRow({
  node,
  depth,
  expandedIds,
  selectedId,
  editingId,
  editingName,
  createDraft,
  forceExpanded,
  onSelect,
  onToggleExpanded,
  onRenameChange,
  onSubmitRename,
  onCancelRename,
  onStartRename,
  onStartCreate,
  onCreateNameChange,
  onSubmitCreate,
  onCancelCreate,
  onDelete,
}: {
  node: TreeNode
  depth: number
  expandedIds: Set<string>
  selectedId: string | null
  editingId: string | null
  editingName: string
  createDraft: DraftState | null
  forceExpanded: boolean
  onSelect: (id: string) => void
  onToggleExpanded: (id: string) => void
  onRenameChange: (value: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onStartRename: (folder: FolderRecord) => void
  onStartCreate: (parentId: string | null) => void
  onCreateNameChange: (value: string) => void
  onSubmitCreate: () => void
  onCancelCreate: () => void
  onDelete: (folder: FolderRecord) => void
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = forceExpanded || expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  const isEditing = editingId === node.id
  const isCreateOpen = createDraft?.parentId === node.id

  return (
    <div>
      <div
        className={[
          'group flex h-8 items-center gap-1 border border-transparent pr-1 transition',
          isSelected
            ? 'bg-base-100/95 shadow-[0_10px_28px_rgba(0,0,0,0.12)] border-base-content/10'
            : 'hover:bg-base-100/55 hover:border-base-content/8',
        ].join(' ')}
        style={{ paddingLeft: depth * 18 }}
      >
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center text-base-content/45 transition hover:bg-base-200/80 hover:text-base-content disabled:cursor-default disabled:hover:bg-transparent"
          onClick={event => {
            event.stopPropagation()
            if (hasChildren) {
              onToggleExpanded(node.id)
            }
          }}
          aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
          disabled={!hasChildren}
        >
          {hasChildren ? (
            isExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />
          ) : (
            <span className="size-4" />
          )}
        </button>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left"
          onClick={() => onSelect(node.id)}
        >
          {isEditing ? (
            <input
              autoFocus
              className="h-7 min-w-0 flex-1 border border-base-content/10 bg-base-100 px-2 text-sm outline-none focus:border-base-content/25"
              value={editingName}
              onChange={event => onRenameChange(event.target.value)}
              onClick={event => event.stopPropagation()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSubmitRename()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelRename()
                }
              }}
            />
          ) : (
            <span className="truncate text-sm text-base-content">{node.name}</span>
          )}
        </button>

        {!isEditing ? (
          <FolderMenu
            onAddFolder={() => onStartCreate(node.id)}
            onRename={() => onStartRename(node)}
            onDelete={() => onDelete(node)}
          />
        ) : null}
      </div>

      {isCreateOpen ? (
        <DraftRow
          value={createDraft.name}
          depth={depth + 1}
          onChange={onCreateNameChange}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      ) : null}

      {hasChildren && isExpanded ? (
        <div className="space-y-0.5">
          {node.children.map(child => (
            <FolderRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedId={selectedId}
              editingId={editingId}
              editingName={editingName}
              createDraft={createDraft}
              forceExpanded={forceExpanded}
              onSelect={onSelect}
              onToggleExpanded={onToggleExpanded}
              onRenameChange={onRenameChange}
              onSubmitRename={onSubmitRename}
              onCancelRename={onCancelRename}
              onStartRename={onStartRename}
              onStartCreate={onStartCreate}
              onCreateNameChange={onCreateNameChange}
              onSubmitCreate={onSubmitCreate}
              onCancelCreate={onCancelCreate}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DraftRow({
  value,
  depth,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  depth: number
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="py-1" style={{ paddingLeft: depth * 18 }}>
      <div className="flex items-center gap-1 border border-base-content/10 bg-base-100/90 pr-1">
        <input
          autoFocus
          className="h-8 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-base-content/35"
          value={value}
          placeholder="Folder name"
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
          aria-label="Cancel new folder"
          title="Cancel"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}

function FolderMenu({
  onAddFolder,
  onRename,
  onDelete,
}: {
  onAddFolder: () => void
  onRename: () => void
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
        title="Folder actions"
        aria-label="Folder actions"
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
          <li>
            <button type="button" onClick={() => runAction(onAddFolder)}>
              <PlusIcon className="size-4" />
              Add Folder
            </button>
          </li>
          <li>
            <button type="button" onClick={() => runAction(onRename)}>
              <PencilIcon className="size-4" />
              Rename
            </button>
          </li>
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-base-content/12 bg-base-100/35 px-5 py-8 text-center">
      <div className="text-sm font-medium text-base-content">{title}</div>
      <div className="mt-1 text-sm text-base-content/50">{description}</div>
    </div>
  )
}

function buildTree(folders: FolderRecord[]) {
  const nodes = folders
    .slice()
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
    .map(folder => ({ ...folder, children: [] as TreeNode[] }))

  const treeMap = new Map(nodes.map(node => [node.id, node]))
  const roots: TreeNode[] = []

  nodes.forEach(node => {
    if (!node.parentId) {
      roots.push(node)
      return
    }

    const parent = treeMap.get(node.parentId)
    if (parent) {
      parent.children.push(node)
      return
    }

    roots.push(node)
  })

  return {
    roots,
    folderMap: new Map(folders.map(folder => [folder.id, folder])),
  }
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes

  return nodes.flatMap(node => {
    const filteredChildren = filterTree(node.children, query)
    const isMatch = node.name.toLowerCase().includes(query)

    if (!isMatch && filteredChildren.length === 0) {
      return []
    }

    return [{ ...node, children: filteredChildren }]
  })
}
