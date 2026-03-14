import { useEffect } from 'react'
import { useSelector } from '@xstate/store/react'
import { CopyIcon, FileCode2Icon, FolderIcon } from 'lucide-react'
import { FolderDetailsFields } from './FolderDetailsFields'
import { RequestExampleDetailsFields } from './RequestExampleDetailsFields'
import { RequestDetailsFields } from './RequestDetailsFields'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { serializeDetails, toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'

export function DetailsPanel() {
  const selected = useSelector(folderExplorerEditorStore, state => state.context.selected)
  const entry = useSelector(folderExplorerEditorStore, state => {
    const currentSelected = state.context.selected
    return currentSelected ? (state.context.entries[toSelectionKey(currentSelected)] ?? null) : null
  })

  const draft = entry?.current ?? null
  const isLoading = Boolean(selected && (!entry || entry.loading))
  const isSaving = Boolean(entry?.saving)
  const isDirty = Boolean(
    entry?.current && (entry.base === null || serializeDetails(entry.current) !== serializeDetails(entry.base))
  )

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

  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
        Select a folder or request
      </div>
    )
  }

  if (isLoading || !draft) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-sm text-base-content/45">
        {/* Loading item details... */}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <div className="flex h-full w-full flex-col items-stretch">
        <div className="w-full px-2 py-2">
          <div className="flex items-center gap-4">
            <div className="shrink-0 rounded-2xl border border-base-content/10 bg-base-100/60 p-3 text-base-content/60">
              {selected.itemType === 'folder' ? (
                <FolderIcon className="size-5" />
              ) : selected.itemType === 'request' ? (
                <FileCode2Icon className="size-5" />
              ) : (
                <CopyIcon className="size-5" />
              )}
            </div>

            <div className="min-w-0 flex-1 flex items-center">
              <div className="flex items-center w-full gap-3">
                <input
                  className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-semibold tracking-tight text-base-content outline-none"
                  value={draft.name}
                   placeholder={selected.itemType === 'folder' ? 'Folder name' : selected.itemType === 'request' ? 'Request name' : 'Example name'}
                  onChange={event =>
                    FolderExplorerCoordinator.updateSelectedDraft({ ...draft, name: event.target.value })
                  }
                  onBlur={() => undefined}
                />

                {draft.itemType !== 'folder' ? <SaveIndicator isDirty={isDirty} isSaving={isSaving} /> : null}
              </div>

              <div className="mt-2 h-5 text-sm text-base-content/45">
                {isSaving && draft.itemType === 'folder' ? 'Saving...' : ' '}
              </div>
            </div>
          </div>
        </div>

        {draft.itemType === 'folder' ? <FolderDetailsFields draft={draft} /> : draft.itemType === 'request' ? <RequestDetailsFields draft={draft} /> : <RequestExampleDetailsFields draft={draft} />}
      </div>
    </div>
  )
}

function SaveIndicator({ isDirty, isSaving }: { isDirty: boolean; isSaving: boolean }) {
  return (
    <div
      className={[
        'size-2.5 shrink-0 rounded-full transition mr-4',
        isSaving ? 'bg-info shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-info)_18%,transparent)]' : '',
        !isSaving && isDirty
          ? 'bg-warning shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-warning)_18%,transparent)]'
          : '',
        !isSaving && !isDirty ? 'bg-base-content/12' : '',
      ].join(' ')}
      aria-label={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
      title={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
    />
  )
}
