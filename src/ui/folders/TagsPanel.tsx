import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { FolderIcon, PlusIcon, TagIcon, Trash2Icon } from 'lucide-react'
import type { ExplorerItem } from '@common/Explorer'
import { normalizeTagColor } from '@common/Tags'
import { dialogActions } from '@/global/dialogStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { RequestMethodTag } from './ExplorerRow'
import { AssignTagItemsDialog } from './AssignTagItemsDialog'
import { TagsCoordinator } from './tagsCoordinator'
import { getItemIdsForTag, tagsStore } from './tagsStore'

export function TagsPanel() {
  const items = useSelector(tagsStore, state => state.context.items)
  const selectedId = useSelector(tagsStore, state => state.context.selectedId)
  const focusTagId = useSelector(tagsStore, state => state.context.focusTagId)
  const loading = useSelector(tagsStore, state => state.context.loading)
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null)
  const [dropIndicatorId, setDropIndicatorId] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const selectedTag = items.find(item => item.id === selectedId) ?? null
  const explorerItemMap = useMemo(
    () => new Map(explorerItems.map(item => [`${item.itemType}:${item.id}`, item] satisfies [string, ExplorerItem])),
    [explorerItems]
  )
  const assignedItems = selectedTag
    ? getItemIdsForTag(selectedTag.id)
        .map(assignment =>
          explorerItems.find(item => item.itemType === assignment.itemType && item.id === assignment.itemId) ?? null
        )
        .filter(
          (item): item is Extract<(typeof explorerItems)[number], { itemType: 'folder' | 'request' }> => item !== null
        )
    : []

  const [draftName, setDraftName] = useState(selectedTag?.name ?? '')
  const [draftColor, setDraftColor] = useState<string | null>(selectedTag?.color ?? null)
  const [isSaving, setIsSaving] = useState(false)
  const draftColorValue = draftColor ?? '#64748b'
  const isDirty = selectedTag ? draftName.trim() !== selectedTag.name || draftColor !== selectedTag.color : false

  useEffect(() => {
    setDraftName(selectedTag?.name ?? '')
    setDraftColor(selectedTag?.color ?? null)
  }, [selectedTag?.id, selectedTag?.name])

  useEffect(() => {
    if (!selectedTag) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveTag()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [draftColor, draftName, selectedTag])

  useEffect(() => {
    if (focusTagId) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
      tagsStore.trigger.focusHandled()
    }
  }, [focusTagId])

  const saveTag = async () => {
    if (!selectedTag) {
      return
    }

    const nextName = draftName.trim()
    const nextColor = draftColor
    if (!nextName) {
      setDraftName(selectedTag.name)
      return
    }

    if (nextName === selectedTag.name && nextColor === selectedTag.color) {
      return
    }

    setIsSaving(true)
    const saved = await TagsCoordinator.saveTag({ id: selectedTag.id, name: nextName, color: nextColor })
    setIsSaving(false)
    if (saved) {
      setDraftName(saved.name)
      setDraftColor(saved.color)
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-base-100">
        <div className="flex items-center justify-between border-b border-base-content/10 px-4 py-4">
          <div className="text-sm font-semibold text-base-content">Tags</div>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-base-200/55 text-base-content transition hover:bg-base-200"
            onClick={() => void TagsCoordinator.createTag()}
            aria-label="Add tag"
            title="Add tag"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {loading ? <div className="px-1 py-3 text-sm text-base-content/45">Loading tags...</div> : null}
          {!loading && items.length === 0 ? <div className="px-1 py-3 text-sm text-base-content/45">No tags yet.</div> : null}

          <div className="space-y-1.5">
            {items.map((item, index) => {
              const isSelected = item.id === selectedId
              const showDropBefore = dropIndicatorId === `${item.id}:before`
              const showDropAfter = dropIndicatorId === `${item.id}:after`
              const count = getItemIdsForTag(item.id).length

              return (
                <div key={item.id} className="relative">
                  {showDropBefore ? <div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 bg-primary" /> : null}
                  <div
                    draggable
                    onDragStart={() => setDraggedTagId(item.id)}
                    onDragEnd={() => {
                      setDraggedTagId(null)
                      setDropIndicatorId(null)
                    }}
                    onDragOver={event => {
                      if (!draggedTagId || draggedTagId === item.id) {
                        return
                      }

                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
                      setDropIndicatorId(`${item.id}:${ratio < 0.5 ? 'before' : 'after'}`)
                    }}
                    onDrop={event => {
                      if (!draggedTagId || draggedTagId === item.id) {
                        return
                      }

                      event.preventDefault()
                      const rect = event.currentTarget.getBoundingClientRect()
                      const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
                      const sourceIndex = items.findIndex(tag => tag.id === draggedTagId)
                      if (sourceIndex < 0) {
                        return
                      }

                      const targetPosition = ratio < 0.5 ? index : index + 1
                      const nextPosition = sourceIndex < targetPosition ? targetPosition - 1 : targetPosition
                      setDraggedTagId(null)
                      setDropIndicatorId(null)
                      void TagsCoordinator.moveTag(draggedTagId, nextPosition)
                    }}
                    className={[
                      'flex cursor-grab items-center gap-3 rounded-2xl px-3 py-3 transition active:cursor-grabbing',
                      isSelected ? 'bg-primary/10 text-base-content' : 'bg-base-200/40 text-base-content/82 hover:bg-base-200/65',
                      draggedTagId === item.id ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => TagsCoordinator.selectTag(item.id)}
                    >
                      <span
                        className="size-3 rounded-full"
                        style={{ backgroundColor: item.color ?? 'color-mix(in oklch, var(--color-base-content) 28%, transparent)' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                      <span className="text-xs text-base-content/45">{count}</span>
                    </button>
                  </div>
                  {showDropAfter ? <div className="pointer-events-none absolute inset-x-3 bottom-0 z-10 h-0.5 bg-primary" /> : null}
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <section className="min-h-0 min-w-0 flex-1 overflow-auto bg-base-100">
        {selectedTag ? (
          <div className="min-h-full px-6 py-6">
            <div className="flex items-center gap-4">
              <div className="group relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-base-200/55 text-base-content/60">
                <TagIcon className="size-5 transition group-hover:opacity-0" />
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center rounded-2xl text-base-content/65 opacity-0 transition group-hover:opacity-100 hover:bg-error/12 hover:text-error"
                  onClick={() => TagsCoordinator.requestDeleteTag(selectedTag.id, selectedTag.name)}
                  aria-label="Delete tag"
                  title="Delete tag"
                >
                  <Trash2Icon className="size-4" />
                </button>
              </div>

              <input
                ref={nameInputRef}
                className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight text-base-content outline-none"
                value={draftName}
                placeholder="Tag name"
                onChange={event => setDraftName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveTag()
                  }
                }}
              />
              <SaveIndicator isDirty={isDirty} isSaving={isSaving} />
            </div>

            <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-base-content">Color</div>
                <div className="mt-1 text-sm text-base-content/55">Use a custom accent to make the tag easier to spot.</div>
              </div>

              <div className="flex w-full items-center gap-3 md:w-auto md:min-w-[280px] md:justify-end">
                <input
                  type="color"
                  className="h-10 w-16 cursor-pointer appearance-none rounded-xl border-0 bg-transparent p-0"
                  value={draftColorValue}
                  onChange={event => setDraftColor(normalizeTagColor(event.target.value))}
                  aria-label="Tag color"
                />
                <div className="min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5 text-sm text-base-content/70 md:max-w-[180px]">
                  {draftColor ?? 'No custom color'}
                </div>
                {draftColor ? (
                  <button
                    type="button"
                    className="rounded-xl border border-base-content/10 px-3 py-2 text-sm text-base-content/65 transition hover:border-base-content/20 hover:bg-base-200 hover:text-base-content"
                    onClick={() => setDraftColor(null)}
                    title="Clear custom color"
                    aria-label="Clear custom color"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium text-base-content">Assigned Items</div>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-base-200/55 text-base-content/72 transition hover:bg-base-200 hover:text-base-content"
                  onClick={() =>
                    dialogActions.open({ component: AssignTagItemsDialog, props: { tagId: selectedTag.id, tagName: selectedTag.name } })
                  }
                  aria-label="Assign items"
                  title="Assign items"
                >
                  <PlusIcon className="size-4" />
                </button>
              </div>
              {assignedItems.length === 0 ? <p className="text-sm text-base-content/45">No items assigned.</p> : null}
              {assignedItems.map(item => (
                <div key={`${item.itemType}:${item.id}`} className="flex items-center gap-3 rounded-2xl bg-base-200/40 px-3 py-2.5">
                  <button
                    type="button"
                    className="flex size-7 shrink-0 items-center justify-center rounded-xl text-base-content/40 transition hover:bg-error/10 hover:text-error"
                    onClick={() =>
                      void TagsCoordinator.replaceTagItems(
                        selectedTag.id,
                        assignedItems
                          .filter(currentItem => !(currentItem.itemType === item.itemType && currentItem.id === item.id))
                          .map(currentItem => ({ itemType: currentItem.itemType, itemId: currentItem.id }))
                      )
                    }
                    aria-label={`Remove ${item.name}`}
                    title={`Remove ${item.name}`}
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                  {item.itemType === 'folder' ? (
                    <FolderIcon className="size-4 shrink-0 text-base-content/55" />
                  ) : (
                    <RequestMethodTag method={item.method} requestType={item.requestType} />
                  )}
                  <button
                    type="button"
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    onClick={() => {
                      TagsCoordinator.setSidebarTab('requests')
                      void FolderExplorerCoordinator.selectItem({ itemType: item.itemType, id: item.id }, { mode: 'pin' })
                    }}
                  >
                    <div className="truncate text-sm font-medium text-base-content">{item.name}</div>
                    <div className="truncate text-xs text-base-content/45">
                      {buildItemPath(explorerItemMap, item.itemType, item.id, item.name)}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-sm text-base-content/45">Select a tag</div>
        )}
      </section>
    </div>
  )
}

function SaveIndicator({ isDirty, isSaving }: { isDirty: boolean; isSaving: boolean }) {
  return (
    <div
      className={[
        'size-2.5 shrink-0 rounded-full transition',
        isSaving ? 'bg-info shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-info)_18%,transparent)]' : '',
        !isSaving && isDirty
          ? 'bg-warning shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-warning)_18%,transparent)]'
          : '',
        !isSaving && !isDirty ? 'bg-base-content/12' : '',
      ].join(' ')}
      aria-label={isSaving ? 'Saving tag' : isDirty ? 'Tag has unsaved changes' : 'Tag is saved'}
      title={isSaving ? 'Saving tag' : isDirty ? 'Tag has unsaved changes' : 'Tag is saved'}
    />
  )
}

function buildItemPath(itemMap: Map<string, ExplorerItem>, itemType: 'folder' | 'request', id: string, name: string) {
  const item = itemMap.get(`${itemType}:${id}`)
  if (!item || (item.itemType !== 'folder' && item.itemType !== 'request')) {
    return name
  }

  return [...getFolderPathSegments(itemMap, item.parentFolderId), name].join(' / ')
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
