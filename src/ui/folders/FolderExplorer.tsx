import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileCode2Icon, FolderIcon, SearchIcon } from 'lucide-react'
import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { DetailsPanel } from './DetailsPanel'
import { DraftRow, EmptyState, ExplorerRow } from './ExplorerRow'
import type { CreateDraft, DetailsDraft, Selection } from './folderExplorerTypes'
import { buildTree, filterTree, serializeDetails, toDetailsDraft, toFolderDetailsDraft, toRequestDetailsDraft, toSelectionKey } from './folderExplorerUtils'

const LAST_SELECTED_TREE_ITEM_KEY = 'folderExplorer:lastSelectedTreeItem'

export function FolderExplorer() {
  const [items, setItems] = useState<ExplorerItem[]>([])
  const [selected, setSelected] = useState<Selection | null>(() => loadLastSelectedTreeItem())
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [folderDetails, setFolderDetails] = useState<FolderRecord | null>(null)
  const [detailsDraft, setDetailsDraft] = useState<DetailsDraft | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isSavingDetails, setIsSavingDetails] = useState(false)
  const [isDetailsDirty, setIsDetailsDirty] = useState(false)
  const detailsDraftRef = useRef<DetailsDraft | null>(null)
  const isDetailsDirtyRef = useRef(false)
  const loadRequestRef = useRef(0)
  const saveRequestRef = useRef(0)

  useEffect(() => {
    detailsDraftRef.current = detailsDraft
  }, [detailsDraft])

  useEffect(() => {
    isDetailsDirtyRef.current = isDetailsDirty
  }, [isDetailsDirty])

  useEffect(() => {
    saveLastSelectedTreeItem(selected)
  }, [selected])

  const loadExplorerItems = useCallback(async () => {
    try {
      const nextItems = await getWindowElectron().listExplorerItems()
      setItems(nextItems)

      setExpandedIds(prev => {
        const validFolderIds = new Set(nextItems.filter(item => item.itemType === 'folder').map(item => item.id))
        const next = new Set([...prev].filter(id => validFolderIds.has(id)))

        if (next.size === 0) {
          nextItems.forEach(item => {
            if (item.itemType === 'folder' && item.parentFolderId === null) {
              next.add(item.id)
            }
          })
        }

        return next
      })

      setSelected(prev => {
        if (prev && nextItems.some(item => item.id === prev.id && item.itemType === prev.itemType)) {
          return prev
        }

        const first = nextItems[0]
        return first ? { itemType: first.itemType, id: first.id } : null
      })
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load explorer items',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  const updateItemNameInList = useCallback((selection: Selection, name: string) => {
    setItems(prev =>
      prev.map(item =>
        item.id === selection.id && item.itemType === selection.itemType ? { ...item, name } : item
      )
    )
  }, [])

  const loadSelectedDetails = useCallback(
    async (selection: Selection) => {
      const requestId = ++loadRequestRef.current
      setIsLoadingDetails(true)

      if (selection.itemType === 'folder') {
        const result = await getWindowElectron().getFolder({ id: selection.id })
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
        updateItemNameInList(selection, result.data.name)
        return
      }

      const result = await getWindowElectron().getRequest({ id: selection.id })
      if (requestId !== loadRequestRef.current) return

      setIsLoadingDetails(false)
      if (!result.success) {
        setFolderDetails(null)
        setDetailsDraft(null)
        toast.show(result)
        return
      }

      setFolderDetails(null)
      setDetailsDraft(toRequestDetailsDraft(result.data))
      setIsDetailsDirty(false)
      updateItemNameInList(selection, result.data.name)
    },
    [updateItemNameInList]
  )

  const saveDetails = useCallback(
    async (draft: DetailsDraft) => {
      if (!selected) return

      const requestId = ++saveRequestRef.current
      setIsSavingDetails(true)

      if (draft.itemType === 'folder') {
        const result = await getWindowElectron().updateFolder({
          id: selected.id,
          name: draft.name,
          description: draft.description,
          preRequestScript: draft.preRequestScript,
          postRequestScript: draft.postRequestScript,
        })

        if (requestId !== saveRequestRef.current) return

        setIsSavingDetails(false)
        if (!result.success) {
          toast.show(result)
          return
        }

        updateItemNameInList(selected, result.data.name)
        setIsDetailsDirty(false)
        setFolderDetails(result.data)
        if (serializeDetails(detailsDraftRef.current) === serializeDetails(draft)) {
          setDetailsDraft(toFolderDetailsDraft(result.data))
        }
        return
      }

      const result = await getWindowElectron().updateRequest({
        id: selected.id,
        name: draft.name,
        method: draft.method,
        url: draft.url,
        preRequestScript: draft.preRequestScript,
        postRequestScript: draft.postRequestScript,
        headers: draft.headers,
        body: draft.body,
        bodyType: draft.bodyType,
        rawType: draft.rawType,
      })

      if (requestId !== saveRequestRef.current) return

      setIsSavingDetails(false)
      if (!result.success) {
        toast.show(result)
        return
      }

      updateItemNameInList(selected, result.data.name)
      setIsDetailsDirty(false)
      if (serializeDetails(detailsDraftRef.current) === serializeDetails(draft)) {
        setDetailsDraft(toRequestDetailsDraft(result.data))
      }
    },
    [selected, updateItemNameInList]
  )

  useEffect(() => {
    void loadExplorerItems()
  }, [loadExplorerItems])

  useEffect(() => {
    if (!selected) {
      setFolderDetails(null)
      setDetailsDraft(null)
      setIsLoadingDetails(false)
      setIsDetailsDirty(false)
      return
    }

    setFolderDetails(null)
    setDetailsDraft(null)
    void loadSelectedDetails(selected)
  }, [loadSelectedDetails, selected])

  useEffect(() => {
    if (!selected || selected.itemType !== 'request') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()

        const draft = detailsDraftRef.current
        if (!draft || draft.itemType !== 'request' || !isDetailsDirtyRef.current) {
          return
        }

        void saveDetails(draft)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [saveDetails, selected])

  const flushDetails = useCallback(() => {
    if (!detailsDraft || !isDetailsDirtyRef.current || detailsDraft.itemType === 'request') {
      return
    }

    const baseDetails = folderDetails
    if (!baseDetails) {
      return
    }

    if (serializeDetails(detailsDraft) === serializeDetails(toDetailsDraft(baseDetails))) {
      return
    }

    void saveDetails(detailsDraft)
  }, [detailsDraft, folderDetails, saveDetails])

  const handleDetailsChange = useCallback((value: DetailsDraft | null) => {
    setDetailsDraft(value)
    setIsDetailsDirty(true)
  }, [])

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
    (itemType: ExplorerItem['itemType'], parentFolderId: string | null) => {
      setCreateDraft({ itemType, parentFolderId, name: '' })

      if (parentFolderId) {
        setExpanded(parentFolderId, true)
        setSelected({ itemType: 'folder', id: parentFolderId })
      }
    },
    [setExpanded]
  )

  const cancelCreate = useCallback(() => {
    setCreateDraft(null)
  }, [])

  const submitCreate = useCallback(async () => {
    if (!createDraft) return

    if (createDraft.itemType === 'folder') {
      const result = await getWindowElectron().createFolder({
        parentFolderId: createDraft.parentFolderId,
        name: createDraft.name,
      })

      if (!result.success) {
        toast.show(result)
        return
      }

      setCreateDraft(null)
      if (createDraft.parentFolderId) {
        setExpanded(createDraft.parentFolderId, true)
      }

      await loadExplorerItems()
      setSelected({ itemType: 'folder', id: result.data.id })
      return
    }

    const result = await getWindowElectron().createRequest({
      parentFolderId: createDraft.parentFolderId,
      name: createDraft.name,
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    setCreateDraft(null)
    if (createDraft.parentFolderId) {
      setExpanded(createDraft.parentFolderId, true)
    }

    await loadExplorerItems()
    setSelected({ itemType: 'request', id: result.data.id })
  }, [createDraft, loadExplorerItems, setExpanded])

  const deleteItem = useCallback(
    (item: ExplorerItem) => {
      const title = item.itemType === 'folder' ? 'Delete folder?' : 'Delete request?'
      const message =
        item.itemType === 'folder'
          ? `"${item.name}" and all nested items will be deleted.`
          : `"${item.name}" will be deleted.`

      confirmation.trigger.confirm({
        title,
        message,
        confirmText: 'Delete',
        onConfirm: async () => {
          const result =
            item.itemType === 'folder'
              ? await getWindowElectron().deleteFolder({ id: item.id })
              : await getWindowElectron().deleteRequest({ id: item.id })

          if (!result.success) {
            toast.show(result)
            return
          }

          if (selected?.id === item.id && selected.itemType === item.itemType) {
            setFolderDetails(null)
            setDetailsDraft(null)
          }

          if (createDraft?.parentFolderId === item.id) {
            cancelCreate()
          }

          await loadExplorerItems()
        },
      })
    },
    [cancelCreate, createDraft?.parentFolderId, loadExplorerItems, selected]
  )

  const { roots, itemMap } = useMemo(() => buildTree(items), [items])
  const selectedItem = selected ? (itemMap.get(toSelectionKey(selected)) ?? null) : null
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
              onClick={() => startCreate('folder', null)}
              aria-label="Add folder"
              title="Add folder"
            >
              <FolderIcon className="size-4" />
            </button>

            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-100/70 text-base-content transition hover:border-base-content/20 hover:bg-base-100"
              onClick={() => startCreate('request', null)}
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
                onChange={event => setSearchQuery(event.target.value)}
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
              onChange={value => setCreateDraft(prev => (prev ? { ...prev, name: value } : prev))}
              onSubmit={() => void submitCreate()}
              onCancel={cancelCreate}
            />
          ) : null}

          {items.length === 0 ? (
            <EmptyState title="No items yet" description="Create your first folder or request to get started." />
          ) : visibleRoots.length === 0 ? (
            <EmptyState title="No matches" description="Try a different item name." />
          ) : (
            <div className="space-y-0.5">
              {visibleRoots.map(node => (
                <ExplorerRow
                  key={toSelectionKey(node)}
                  node={node}
                  depth={0}
                  expandedIds={expandedIds}
                  selected={selected}
                  createDraft={createDraft}
                  forceExpanded={normalizedSearch.length > 0}
                  onSelect={setSelected}
                  onToggleExpanded={id => setExpanded(id, !expandedIds.has(id))}
                  onStartCreate={startCreate}
                  onCreateNameChange={value => setCreateDraft(prev => (prev ? { ...prev, name: value } : prev))}
                  onSubmitCreate={() => void submitCreate()}
                  onCancelCreate={cancelCreate}
                  onDelete={deleteItem}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col bg-base-100">
        {selectedItem ? (
          <DetailsPanel
            item={selectedItem}
            draft={detailsDraft}
            isDirty={isDetailsDirty}
            isLoading={isLoadingDetails}
            isSaving={isSavingDetails}
            onChange={handleDetailsChange}
            onBlur={flushDetails}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
            Select a folder or request
          </div>
        )}
      </main>
    </div>
  )
}

function loadLastSelectedTreeItem(): Selection | null {
  try {
    const value = localStorage.getItem(LAST_SELECTED_TREE_ITEM_KEY)
    if (!value) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<Selection>
    if ((parsed.itemType === 'folder' || parsed.itemType === 'request') && typeof parsed.id === 'string') {
      return {
        itemType: parsed.itemType,
        id: parsed.id,
      }
    }
  } catch {
    return null
  }

  return null
}

function saveLastSelectedTreeItem(selection: Selection | null) {
  try {
    if (!selection) {
      localStorage.removeItem(LAST_SELECTED_TREE_ITEM_KEY)
      return
    }

    localStorage.setItem(LAST_SELECTED_TREE_ITEM_KEY, JSON.stringify(selection))
  } catch {
    return
  }
}
