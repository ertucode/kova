import { useEffect, useRef } from 'react'
import { useSelector } from '@xstate/store/react'
import { CopyIcon, FileCode2Icon, FolderIcon, RotateCcwIcon } from 'lucide-react'
import { dialogActions } from '@/global/dialogStore'
import { FolderDetailsFields } from './FolderDetailsFields'
import { RequestExampleDetailsFields } from './RequestExampleDetailsFields'
import { RequestDetailsFields } from './RequestDetailsFields'
import { UnsavedChangesDebugDialog } from './UnsavedChangesDebugDialog'
import { WebSocketRequestDetailsFields } from './WebSocketRequestDetailsFields'
import { WebSocketExampleDetailsFields } from './WebSocketExampleDetailsFields'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore, type EditorEntry } from './folderExplorerEditorStore'

export function DetailsPanel() {
  const selected = useSelector(folderExplorerEditorStore, state => state.context.selected)
  const pendingSelection = useSelector(folderExplorerEditorStore, state => state.context.pendingSelection)
  const entry = useSelector(folderExplorerEditorStore, state => {
    const currentSelected = state.context.selected
    return currentSelected ? (state.context.entries[toSelectionKey(currentSelected)] ?? null) : null
  })

  const selectedKey = selected ? toSelectionKey(selected) : null
  const draft = entry?.current ?? null
  const lastDraftRef = useRef<typeof draft>(null)
  const lastDraftKeyRef = useRef<string | null>(null)
  const isPendingSelectionChange = Boolean(
    selected &&
      pendingSelection &&
      (pendingSelection.itemType !== selected.itemType || pendingSelection.id !== selected.id)
  )

  if (draft && !entry?.loading && selectedKey) {
    lastDraftRef.current = draft
    lastDraftKeyRef.current = selectedKey
  }

  const displayDraft = selectedKey !== null && lastDraftKeyRef.current === selectedKey ? (lastDraftRef.current ?? draft) : draft
  const isLoading = Boolean(selected && (!entry || entry.loading))
  const isSaving = Boolean(entry?.saving)

  useEffect(() => {
    if (!selected) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void FolderExplorerCoordinator.saveSelectedItem()
        return
      }

      if (selected.itemType === 'request' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void FolderExplorerCoordinator.duplicateSelectedRequest()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selected])

  if (!selected && !displayDraft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
        Select a folder or request
      </div>
    )
  }

  const renderDraft = isLoading && displayDraft ? displayDraft : draft

  if (!renderDraft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
        {/* Loading item details... */}
      </div>
    )
  }

  const renderSelected = selected ?? displayDraft!
  const renderSelectionKey = selectedKey ?? lastDraftKeyRef.current ?? 'details-panel'

  const updateDisplayedDraftName = (name: string) => {
    if (!selected) {
      return
    }

    FolderExplorerCoordinator.updateSelectedDraftIfMatching(selected, { ...renderDraft, name }, 'details-name')
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex h-full min-w-0 w-full flex-col items-stretch">
        <div className="w-full">
          <div className="flex items-center gap-2">
            <div className="shrink-0 border-r border-base-content/10 bg-base-100/60 p-2 text-base-content/60">
              {renderSelected.itemType === 'folder' ? (
                <FolderIcon className="size-4" />
              ) : renderSelected.itemType === 'request' ? (
                <FileCode2Icon className="size-4" />
              ) : (
                <CopyIcon className="size-4" />
              )}
            </div>

            <div className="min-w-0 flex-1 flex items-center">
              <div className="flex items-center w-full gap-3">
                <input
                  className="w-full border-0 bg-transparent px-0 py-0.5 text-sm font-semibold tracking-tight text-base-content outline-none"
                  value={renderDraft.name}
                  placeholder={
                    renderSelected.itemType === 'folder'
                      ? 'Folder name'
                      : renderSelected.itemType === 'request'
                        ? 'Request name'
                        : 'Example name'
                  }
                  readOnly={isPendingSelectionChange}
                  onChange={event => updateDisplayedDraftName(event.target.value)}
                  onBlur={() => undefined}
                />

                <SaveIndicator entry={entry ?? null} itemName={renderDraft.name} />
              </div>

              <div className="mt-2 h-5 text-sm text-base-content/45">
                {isSaving && renderDraft.itemType === 'folder' ? 'Saving...' : ' '}
              </div>
            </div>
          </div>
        </div>

        <div key={renderSelectionKey} className={isPendingSelectionChange ? 'pointer-events-none' : ''}>
          {renderDraft.itemType === 'folder' ? (
            <FolderDetailsFields draft={renderDraft} />
          ) : renderDraft.itemType === 'request' ? (
            renderDraft.requestType === 'websocket' ? (
              <WebSocketRequestDetailsFields draft={renderDraft} />
            ) : (
              <RequestDetailsFields draft={renderDraft} />
            )
          ) : renderDraft.exampleType === 'websocket' ? (
            <WebSocketExampleDetailsFields draft={renderDraft} />
          ) : (
            <RequestExampleDetailsFields draft={renderDraft} />
          )}
        </div>
      </div>
    </div>
  )
}

function SaveIndicator({ entry, itemName }: { entry: EditorEntry | null; itemName: string }) {
  const isDirty = Boolean(entry?.isDirty)
  const isSaving = Boolean(entry?.saving)

  return (
    <div className="group relative mr-4 flex shrink-0 items-center">
      <div
        className={[
          'size-2.5 shrink-0 rounded-full transition',
          isSaving ? 'bg-info shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-info)_18%,transparent)]' : '',
          !isSaving && isDirty
            ? 'bg-warning shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-warning)_18%,transparent)]'
            : '',
          !isSaving && !isDirty ? 'bg-base-content/12' : '',
        ].join(' ')}
        aria-label={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
        title={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
      />

      {!isSaving && isDirty ? (
        <>
          <div className="pointer-events-none absolute right-0 top-1/2 z-10 inline-flex -translate-y-1/2 overflow-hidden rounded-full border border-warning/25 bg-base-100 opacity-0 shadow-[0_14px_30px_rgba(0,0,0,0.14)] transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            <button
              type="button"
              className="flex items-center gap-1.5 whitespace-nowrap border-r border-warning/15 px-2.5 py-1 text-[11px] font-semibold text-base-content/70 transition hover:bg-warning/6 hover:text-base-content"
              onClick={() => dialogActions.open({ component: UnsavedChangesDebugDialog, props: { entry, itemName } })}
              title="Show pending changes diff"
            >
              <span>Show diff</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 whitespace-nowrap px-1.5 py-1 text-[11px] font-semibold text-base-content/70 transition hover:bg-warning/6 hover:text-base-content"
              onClick={() => FolderExplorerCoordinator.discardSelectedChanges()}
              title="Remove unsaved changes"
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-warning/12 text-warning">
                <RotateCcwIcon className="size-3" />
              </span>
              <span>Remove unsaved changes</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
