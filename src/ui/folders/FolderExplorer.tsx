import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
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

  const loadFolders = useCallback(async () => {
    try {
      const nextFolders = await getWindowElectron().listFolders()
      setFolders(nextFolders)

      setExpandedIds(prev => {
        const ids = new Set(nextFolders.map(folder => folder.id))
        const next = new Set([...prev].filter(id => ids.has(id)))

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

  const { roots, folderMap, treeMap } = useMemo(() => buildTree(folders), [folders])
  const selectedFolder = selectedId ? folderMap.get(selectedId) ?? null : null
  const selectedTreeNode = selectedId ? treeMap.get(selectedId) ?? null : null

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

  const startCreate = useCallback((parentId: string | null) => {
    setEditingId(null)
    setEditingName('')
    setCreateDraft({ parentId, name: '' })
    if (parentId) {
      setExpanded(parentId, true)
      setSelectedId(parentId)
    }
  }, [setExpanded])

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

  const deleteFolder = useCallback((folder: FolderRecord) => {
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
  }, [cancelCreate, cancelRename, createDraft?.parentId, editingId, loadFolders])

  const moveFolder = useCallback(async (id: string, parentId: string | null, position: number) => {
    const result = await getWindowElectron().moveFolder({ id, parentId, position })
    if (!result.success) {
      toast.show(result)
      return
    }

    if (parentId) {
      setExpanded(parentId, true)
    }
    await loadFolders()
  }, [loadFolders, setExpanded])

  return (
    <div className="flex min-h-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-base-200/35">
        <div className="flex items-center justify-between border-b border-base-content/10 px-4 py-3">
          <div className="text-sm font-medium text-base-content">Folders</div>
          <button className="btn btn-ghost btn-sm" onClick={() => startCreate(null)}>
            <PlusIcon className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {createDraft?.parentId === null ? (
            <DraftRow
              value={createDraft.name}
              onChange={value => setCreateDraft({ parentId: null, name: value })}
              onSubmit={() => void submitCreate()}
              onCancel={cancelCreate}
            />
          ) : null}

          {roots.length === 0 ? (
            <div className="px-3 py-4 text-sm text-base-content/45">No folders</div>
          ) : (
            roots.map(node => (
              <FolderNode
                key={node.id}
                node={node}
                depth={0}
                treeMap={treeMap}
                expandedIds={expandedIds}
                selectedId={selectedId}
                editingId={editingId}
                editingName={editingName}
                createDraft={createDraft}
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
                onMove={moveFolder}
              />
            ))
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-base-100">
        <div className="border-b border-base-content/10 px-6 py-4">
          <div className="text-sm font-medium text-base-content">{selectedFolder?.name ?? 'Folders'}</div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 py-5 text-sm text-base-content/60">
          {selectedFolder ? (
            <div className="space-y-4">
              <div className="grid max-w-xl grid-cols-[140px_1fr] gap-y-3">
                <div className="text-base-content/45">Name</div>
                <div className="text-base-content">{selectedFolder.name}</div>
                <div className="text-base-content/45">Children</div>
                <div className="text-base-content">{selectedTreeNode?.children.length ?? 0}</div>
                <div className="text-base-content/45">Created</div>
                <div className="text-base-content">{new Date(selectedFolder.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ) : (
            <div>Select a folder</div>
          )}
        </div>
      </main>
    </div>
  )
}

function FolderNode({
  node,
  depth,
  treeMap,
  expandedIds,
  selectedId,
  editingId,
  editingName,
  createDraft,
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
  onMove,
}: {
  node: TreeNode
  depth: number
  treeMap: Map<string, TreeNode>
  expandedIds: Set<string>
  selectedId: string | null
  editingId: string | null
  editingName: string
  createDraft: DraftState | null
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
  onMove: (id: string, parentId: string | null, position: number) => Promise<void>
}) {
  const isExpanded = expandedIds.has(node.id)
  const isSelected = selectedId === node.id
  const isEditing = editingId === node.id
  const isCreateOpen = createDraft?.parentId === node.id
  const siblingIds = node.parentId ? treeMap.get(node.parentId)?.children.map(child => child.id) ?? [] : []
  const rootIds = !node.parentId ? Array.from(treeMap.values()).filter(item => item.parentId === null).map(item => item.id) : []
  const currentSiblingIds = node.parentId ? siblingIds : rootIds
  const index = currentSiblingIds.indexOf(node.id)
  const hasChildren = node.children.length > 0

  const moveIn = async () => {
    if (index <= 0) return
    const prevSibling = treeMap.get(currentSiblingIds[index - 1])
    if (!prevSibling) return
    await onMove(node.id, prevSibling.id, prevSibling.children.length)
  }

  const moveOut = async () => {
    if (!node.parentId) return
    const parent = treeMap.get(node.parentId)
    if (!parent) return
    await onMove(node.id, parent.parentId, parent.position + 1)
  }

  return (
    <div>
      <div
        className={[
          'group flex items-center gap-1 rounded-md px-2 py-1 text-sm',
          isSelected ? 'bg-primary/14 text-base-content' : 'text-base-content/78 hover:bg-base-300/35',
        ].join(' ')}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          className="flex size-5 items-center justify-center rounded text-base-content/45 hover:bg-base-300/40 hover:text-base-content"
          onClick={() => (hasChildren ? onToggleExpanded(node.id) : undefined)}
          type="button"
        >
          {hasChildren ? (isExpanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />) : null}
        </button>

        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          type="button"
          onClick={() => onSelect(node.id)}
        >
          {isExpanded ? <FolderOpenIcon className="size-4 shrink-0 text-base-content/55" /> : <FolderIcon className="size-4 shrink-0 text-base-content/55" />}
          {isEditing ? (
            <input
              autoFocus
              className="input input-xs h-7 min-w-0 flex-1"
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
            <span className="truncate">{node.name}</span>
          )}
        </button>

        {!isEditing ? (
          <div className="flex items-center opacity-0 transition group-hover:opacity-100">
            <ActionButton label="Add child" icon={<PlusIcon className="size-3.5" />} onClick={() => onStartCreate(node.id)} />
            <ActionButton label="Rename" icon={<PencilIcon className="size-3.5" />} onClick={() => onStartRename(node)} />
            <ActionButton label="Delete" icon={<Trash2Icon className="size-3.5" />} danger onClick={() => onDelete(node)} />
            <MenuButton onMoveIn={() => void moveIn()} onMoveOut={() => void moveOut()} canMoveIn={index > 0} canMoveOut={!!node.parentId} />
          </div>
        ) : null}
      </div>

      {isCreateOpen ? (
        <div style={{ paddingLeft: 26 + depth * 18 }}>
          <DraftRow value={createDraft.name} onChange={onCreateNameChange} onSubmit={onSubmitCreate} onCancel={onCancelCreate} />
        </div>
      ) : null}

      {hasChildren && isExpanded
        ? node.children.map(child => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              treeMap={treeMap}
              expandedIds={expandedIds}
              selectedId={selectedId}
              editingId={editingId}
              editingName={editingName}
              createDraft={createDraft}
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
              onMove={onMove}
            />
          ))
        : null}
    </div>
  )
}

function DraftRow({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="my-1 rounded-md border border-base-content/10 bg-base-100 p-2">
      <input
        autoFocus
        className="input input-sm h-8 w-full"
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
    </div>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={[
        'flex size-6 items-center justify-center rounded text-base-content/45 hover:bg-base-300/45 hover:text-base-content',
        danger ? 'hover:text-error' : '',
      ].join(' ')}
      onClick={event => {
        event.stopPropagation()
        onClick()
      }}
    >
      {icon}
    </button>
  )
}

function MenuButton({
  onMoveIn,
  onMoveOut,
  canMoveIn,
  canMoveOut,
}: {
  onMoveIn: () => void
  onMoveOut: () => void
  canMoveIn: boolean
  canMoveOut: boolean
}) {
  return (
    <div className="dropdown dropdown-end">
      <button
        type="button"
        tabIndex={0}
        title="More"
        aria-label="More"
        className="flex size-6 items-center justify-center rounded text-base-content/45 hover:bg-base-300/45 hover:text-base-content"
        onClick={event => event.stopPropagation()}
      >
        <MoreHorizontalIcon className="size-3.5" />
      </button>
      <ul tabIndex={0} className="menu dropdown-content z-10 mt-1 w-40 rounded-box border border-base-content/10 bg-base-100 p-1 shadow-lg">
        <li>
          <button type="button" disabled={!canMoveIn} onClick={onMoveIn}>
            Nest into previous
          </button>
        </li>
        <li>
          <button type="button" disabled={!canMoveOut} onClick={onMoveOut}>
            Move after parent
          </button>
        </li>
      </ul>
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
    } else {
      roots.push(node)
    }
  })

  return {
    roots,
    treeMap,
    folderMap: new Map(folders.map(folder => [folder.id, folder])),
  }
}
