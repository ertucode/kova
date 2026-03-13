import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { useDebounce } from '@/lib/hooks/useDebounce'
import type { FolderListItem, FolderRecord } from '@common/Folders'

type TreeNode = FolderListItem & {
  children: TreeNode[]
}

type DraftState = {
  parentId: string | null
  name: string
}

type FolderDetailsDraft = {
  name: string
  description: string
  preRequestScript: string
  postRequestScript: string
}

export function FolderExplorer() {
  const [folders, setFolders] = useState<FolderListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [createDraft, setCreateDraft] = useState<DraftState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [folderDetails, setFolderDetails] = useState<FolderRecord | null>(null)
  const [detailsDraft, setDetailsDraft] = useState<FolderDetailsDraft | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isSavingDetails, setIsSavingDetails] = useState(false)
  const [isDetailsDirty, setIsDetailsDirty] = useState(false)
  const [headerEditingId, setHeaderEditingId] = useState<string | null>(null)
  const [headerEditingName, setHeaderEditingName] = useState('')
  const debouncedDetailsDraft = useDebounce(detailsDraft, 500)
  const detailsDraftRef = useRef<FolderDetailsDraft | null>(null)
  const isDetailsDirtyRef = useRef(false)
  const loadRequestRef = useRef(0)
  const saveRequestRef = useRef(0)

  useEffect(() => {
    detailsDraftRef.current = detailsDraft
  }, [detailsDraft])

  useEffect(() => {
    isDetailsDirtyRef.current = isDetailsDirty
  }, [isDetailsDirty])

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

  const updateFolderNameInList = useCallback((id: string, name: string) => {
    setFolders(prev => prev.map(folder => (folder.id === id ? { ...folder, name } : folder)))
  }, [])

  const loadFolderDetails = useCallback(
    async (id: string) => {
      const requestId = ++loadRequestRef.current
      setIsLoadingDetails(true)

      const result = await getWindowElectron().getFolder({ id })
      if (requestId !== loadRequestRef.current) return

      setIsLoadingDetails(false)

      if (!result.success) {
        setFolderDetails(null)
        setDetailsDraft(null)
        toast.show(result)
        return
      }

      setFolderDetails(result.data)
      setDetailsDraft(toFolderDetailsDraft(result.data))
      setIsDetailsDirty(false)
      updateFolderNameInList(result.data.id, result.data.name)
    },
    [updateFolderNameInList]
  )

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  useEffect(() => {
    if (!selectedId) {
      setFolderDetails(null)
      setDetailsDraft(null)
      setIsLoadingDetails(false)
      setIsDetailsDirty(false)
      setHeaderEditingId(null)
      setHeaderEditingName('')
      return
    }

    setFolderDetails(null)
    setDetailsDraft(null)
    void loadFolderDetails(selectedId)
  }, [loadFolderDetails, selectedId])

  const { roots, folderMap } = useMemo(() => buildTree(folders), [folders])
  const selectedFolder = selectedId ? folderMap.get(selectedId) ?? null : null
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const visibleRoots = useMemo(() => filterTree(roots, normalizedSearch), [roots, normalizedSearch])

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

  const startRename = useCallback((folder: FolderListItem) => {
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

    updateFolderNameInList(editingId, editingName.trim())

    setFolderDetails(prev => (prev && prev.id === editingId ? { ...prev, name: editingName.trim() } : prev))
    setDetailsDraft(prev => (prev && editingId === selectedId ? { ...prev, name: editingName.trim() } : prev))
    setEditingId(null)
    setEditingName('')
    await loadFolders()
  }, [editingId, editingName, loadFolders, selectedId, updateFolderNameInList])

  const startHeaderRename = useCallback((folder: FolderListItem) => {
    setHeaderEditingId(folder.id)
    setHeaderEditingName(folder.name)
  }, [])

  const cancelHeaderRename = useCallback(() => {
    setHeaderEditingId(null)
    setHeaderEditingName('')
  }, [])

  const submitHeaderRename = useCallback(async () => {
    if (!headerEditingId) return

    const result = await getWindowElectron().renameFolder({ id: headerEditingId, name: headerEditingName })
    if (!result.success) {
      toast.show(result)
      return
    }

    const nextName = headerEditingName.trim()
    updateFolderNameInList(headerEditingId, nextName)
    setFolderDetails(prev => (prev && prev.id === headerEditingId ? { ...prev, name: nextName } : prev))
    setDetailsDraft(prev => (prev && headerEditingId === selectedId ? { ...prev, name: nextName } : prev))
    setHeaderEditingId(null)
    setHeaderEditingName('')
    await loadFolders()
  }, [headerEditingId, headerEditingName, loadFolders, selectedId, updateFolderNameInList])

  const deleteFolder = useCallback(
    (folder: FolderListItem) => {
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

          if (selectedId === folder.id) {
            setFolderDetails(null)
            setDetailsDraft(null)
          }

          await loadFolders()
        },
      })
    },
    [cancelCreate, cancelRename, createDraft?.parentId, editingId, loadFolders, selectedId]
  )

  const saveFolderDetails = useCallback(
    async (draft: FolderDetailsDraft) => {
      if (!selectedId) return

      const requestId = ++saveRequestRef.current
      setIsSavingDetails(true)

      const result = await getWindowElectron().updateFolder({
        id: selectedId,
        name: draft.name,
        description: draft.description,
        preRequestScript: draft.preRequestScript,
        postRequestScript: draft.postRequestScript,
      })

      if (requestId !== saveRequestRef.current) {
        return
      }

      setIsSavingDetails(false)

      if (!result.success) {
        toast.show(result)
        return
      }

      setFolderDetails(result.data)
      updateFolderNameInList(result.data.id, result.data.name)
      setIsDetailsDirty(false)

      if (serializeDetails(detailsDraftRef.current) === serializeDetails(draft)) {
        setDetailsDraft(toFolderDetailsDraft(result.data))
      }
    },
    [selectedId, updateFolderNameInList]
  )

  useEffect(() => {
    if (!folderDetails || !debouncedDetailsDraft || !selectedId || !isDetailsDirty) {
      return
    }

    if (serializeDetails(debouncedDetailsDraft) === serializeDetails(toFolderDetailsDraft(folderDetails))) {
      return
    }

    void saveFolderDetails(debouncedDetailsDraft)
  }, [debouncedDetailsDraft, folderDetails, isDetailsDirty, saveFolderDetails, selectedId])

  const flushFolderDetails = useCallback(() => {
    if (!folderDetails || !detailsDraft || !isDetailsDirtyRef.current) {
      return
    }

    if (serializeDetails(detailsDraft) === serializeDetails(toFolderDetailsDraft(folderDetails))) {
      return
    }

    void saveFolderDetails(detailsDraft)
  }, [detailsDraft, folderDetails, saveFolderDetails])

  const handleDetailsChange = useCallback((value: FolderDetailsDraft | null) => {
    setDetailsDraft(value)
    setIsDetailsDirty(true)
  }, [])

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
                  forceExpanded={normalizedSearch.length > 0}
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

      <main className="flex min-h-0 flex-1 flex-col bg-base-100">
        {selectedFolder ? (
          <FolderDetailsPanel
            folderName={selectedFolder.name}
            draft={detailsDraft}
            editingId={headerEditingId}
            editingName={headerEditingName}
            isLoading={isLoadingDetails}
            isSaving={isSavingDetails}
            onChange={handleDetailsChange}
            onBlur={flushFolderDetails}
            onStartRename={() => startHeaderRename(selectedFolder)}
            onRenameChange={setHeaderEditingName}
            onSubmitRename={() => void submitHeaderRename()}
            onCancelRename={cancelHeaderRename}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
            Select a folder
          </div>
        )}
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
  onStartRename: (folder: FolderListItem) => void
  onStartCreate: (parentId: string | null) => void
  onCreateNameChange: (value: string) => void
  onSubmitCreate: () => void
  onCancelCreate: () => void
  onDelete: (folder: FolderListItem) => void
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
            ? 'bg-base-100/95 border-base-content/10 shadow-[0_10px_28px_rgba(0,0,0,0.12)]'
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

        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(node.id)}>
          <div className="relative h-7 w-full">
            <span
              className={[
                'block truncate px-2 py-1.5 text-sm text-base-content transition',
                isEditing ? 'pointer-events-none opacity-0' : 'opacity-100',
              ].join(' ')}
            >
              {node.name}
            </span>

            {isEditing ? (
              <input
                autoFocus
                className="absolute inset-0 h-7 w-full border border-base-content/10 bg-base-100 px-2 text-sm outline-none focus:border-base-content/25"
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
            ) : null}
          </div>
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

function FolderDetailsPanel({
  folderName,
  draft,
  editingId,
  editingName,
  isLoading,
  isSaving,
  onChange,
  onBlur,
  onStartRename,
  onRenameChange,
  onSubmitRename,
  onCancelRename,
}: {
  folderName: string
  draft: FolderDetailsDraft | null
  editingId: string | null
  editingName: string
  isLoading: boolean
  isSaving: boolean
  onChange: (value: FolderDetailsDraft | null) => void
  onBlur: () => void
  onStartRename: () => void
  onRenameChange: (value: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
}) {
  if (isLoading || !draft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
        Loading folder details...
      </div>
    )
  }

  const isRenaming = editingId !== null

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full max-w-4xl flex-col items-start">
        <div className="w-full px-8 py-8">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <div
                className={[
                  'truncate py-0.5 text-3xl font-semibold tracking-tight text-base-content transition',
                  isRenaming ? 'pointer-events-none opacity-0' : 'opacity-100',
                ].join(' ')}
              >
                {folderName}
              </div>

              {isRenaming ? (
                <input
                  autoFocus
                  className="absolute inset-0 h-full w-full border border-base-content/10 bg-base-100 px-3 text-3xl font-semibold tracking-tight text-base-content outline-none"
                  value={editingName}
                  onChange={event => onRenameChange(event.target.value)}
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
                  onBlur={onSubmitRename}
                />
              ) : null}
            </div>

            {!isRenaming ? (
              <button
                type="button"
                className="flex size-7 items-center justify-center text-base-content/45 transition hover:bg-base-200/80 hover:text-base-content"
                onClick={onStartRename}
                aria-label="Rename folder"
                title="Rename folder"
              >
                <PencilIcon className="size-4" />
              </button>
            ) : null}
          </div>
          {isSaving ? <div className="mt-2 text-sm text-base-content/45">Saving...</div> : null}
        </div>

        <DetailsTextArea
          label={null}
          value={draft.description}
          minHeightClassName="min-h-28"
          placeholder="Describe what this folder is for"
          onChange={value => onChange({ ...draft, description: value })}
          onBlur={onBlur}
        />

        <DetailsTextArea
          label="Pre-request Script"
          value={draft.preRequestScript}
          minHeightClassName="min-h-40"
          onChange={value => onChange({ ...draft, preRequestScript: value })}
          onBlur={onBlur}
        />

        <DetailsTextArea
          label="Post-request Script"
          value={draft.postRequestScript}
          minHeightClassName="min-h-40"
          onChange={value => onChange({ ...draft, postRequestScript: value })}
          onBlur={onBlur}
        />
      </div>
    </div>
  )
}

function DetailsTextArea({
  label,
  value,
  minHeightClassName,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string | null
  value: string
  minHeightClassName: string
  placeholder?: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <section className="w-full border-b border-base-content/10 px-8 py-6">
      {label ? <div className="mb-2 text-sm text-base-content/55">{label}</div> : null}
      <textarea
        className={[
          'textarea w-full rounded-none border-base-content/10 bg-base-100/70 font-mono text-sm leading-6',
          minHeightClassName,
        ].join(' ')}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </section>
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
    <div className="mx-4 rounded-[24px] border border-dashed border-base-content/12 bg-base-100/35 px-5 py-8 text-center">
      <div className="text-sm font-medium text-base-content">{title}</div>
      <div className="mt-1 text-sm text-base-content/50">{description}</div>
    </div>
  )
}

function buildTree(folders: FolderListItem[]) {
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

function toFolderDetailsDraft(folder: FolderRecord): FolderDetailsDraft {
  return {
    name: folder.name,
    description: folder.description,
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
  }
}

function serializeDetails(value: FolderDetailsDraft | null) {
  if (!value) return ''

  return JSON.stringify(value)
}
