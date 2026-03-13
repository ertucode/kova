import { useEffect } from 'react'
import { useSelector } from '@xstate/store/react'
import { FileCode2Icon, FolderIcon } from 'lucide-react'
import type { RequestBodyType, RequestMethod, RequestRawType } from '@common/Requests'
import { HeadersEditor } from './HeadersEditor'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import {
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
  type FolderDetailsDraft,
  type RequestDetailsDraft,
} from './folderExplorerTypes'
import { serializeDetails, toSelectionKey } from './folderExplorerUtils'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'

export function DetailsPanel() {
  const selected = useSelector(folderExplorerEditorStore, state => state.context.selected)
  const entry = useSelector(folderExplorerEditorStore, state => {
    const currentSelected = state.context.selected
    return currentSelected ? state.context.entries[toSelectionKey(currentSelected)] ?? null : null
  })

  const draft = entry?.current ?? null
  const isLoading = Boolean(selected && (!entry || entry.loading))
  const isSaving = Boolean(entry?.saving)
  const isDirty = Boolean(entry?.current && (entry.base === null || serializeDetails(entry.current) !== serializeDetails(entry.base)))

  useEffect(() => {
    if (!selected || selected.itemType !== 'request') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void FolderExplorerCoordinator.saveSelectedItem()
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
        Loading item details...
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex w-full flex-col items-stretch">
        <div className="w-full px-8 py-8">
          <div className="flex items-center gap-4">
            <div className="shrink-0 rounded-2xl border border-base-content/10 bg-base-100/60 p-3 text-base-content/60">
              {selected.itemType === 'folder' ? <FolderIcon className="size-5" /> : <FileCode2Icon className="size-5" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <input
                  className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-semibold tracking-tight text-base-content outline-none"
                  value={draft.name}
                  placeholder={selected.itemType === 'folder' ? 'Folder name' : 'Request name'}
                  onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, name: event.target.value })}
                  onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
                />

                {draft.itemType === 'request' ? <SaveIndicator isDirty={isDirty} isSaving={isSaving} /> : null}
              </div>

              <div className="mt-2 h-5 text-sm text-base-content/45">
                {isSaving && draft.itemType === 'folder' ? 'Saving...' : ' '}
              </div>
            </div>
          </div>
        </div>

        {draft.itemType === 'folder' ? <FolderDetailsFields draft={draft} /> : <RequestDetailsFields draft={draft} />}
      </div>
    </div>
  )
}

function SaveIndicator({ isDirty, isSaving }: { isDirty: boolean; isSaving: boolean }) {
  return (
    <div
      className={[
        'size-2.5 shrink-0 rounded-full transition',
        isSaving ? 'bg-info shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-info)_18%,transparent)]' : '',
        !isSaving && isDirty ? 'bg-warning shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-warning)_18%,transparent)]' : '',
        !isSaving && !isDirty ? 'bg-base-content/12' : '',
      ].join(' ')}
      aria-label={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
      title={isSaving ? 'Saving request' : isDirty ? 'Request has unsaved changes' : 'Request is saved'}
    />
  )
}

function FolderDetailsFields({ draft }: { draft: FolderDetailsDraft }) {
  return (
    <>
      <DetailsTextArea
        label={null}
        value={draft.description}
        minHeightClassName="min-h-28"
        placeholder="Describe what this folder is for"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, description: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />

      <DetailsTextArea
        label="Pre-request Script"
        value={draft.preRequestScript}
        minHeightClassName="min-h-40"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />

      <DetailsTextArea
        label="Post-request Script"
        value={draft.postRequestScript}
        minHeightClassName="min-h-40"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />
    </>
  )
}

function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  return (
    <>
      <section className="w-full border-b border-base-content/10 px-8 pb-6">
        <div className="flex w-full overflow-hidden border border-base-content/10 bg-base-100/70">
          <select
            className="w-[118px] shrink-0 border-0 border-r border-base-content/10 bg-transparent px-3 py-4 text-sm font-semibold outline-none"
            value={draft.method}
            onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, method: event.target.value as RequestMethod })}
          >
            {REQUEST_METHODS.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <input
            className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 text-sm outline-none"
            value={draft.url}
            placeholder="https://api.example.com/resource"
            onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, url: event.target.value })}
          />

          <button
            type="button"
            className="shrink-0 border-0 border-l border-base-content/10 bg-base-200 px-6 py-4 text-sm font-medium text-base-content transition hover:bg-base-300"
          >
            Send
          </button>
        </div>
      </section>

      <section className="grid w-full border-b border-base-content/10 md:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <div className="border-b border-base-content/10 md:border-b-0 md:border-r md:border-base-content/10">
          <div className="border-b border-base-content/10 px-8 py-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="text-sm text-base-content/55">Body</div>
              <select
                className="select select-sm w-auto rounded-none border-base-content/10 bg-base-100/70"
                value={draft.bodyType}
                onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, bodyType: event.target.value as RequestBodyType })}
              >
                {REQUEST_BODY_TYPES.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="select select-sm w-auto rounded-none border-base-content/10 bg-base-100/70"
                value={draft.rawType}
                onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, rawType: event.target.value as RequestRawType })}
                disabled={draft.bodyType !== 'raw'}
              >
                {REQUEST_RAW_TYPES.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              className="textarea min-h-[360px] w-full rounded-none border-base-content/10 bg-base-100/70 font-mono text-sm leading-6"
              value={draft.body}
              placeholder={draft.bodyType === 'raw' ? '{\n  "hello": "world"\n}' : ''}
              onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: event.target.value })}
            />
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <HeadersEditor value={draft.headers} onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })} />

          <DetailsTextArea
            label="Pre-request Script"
            value={draft.preRequestScript}
            minHeightClassName="min-h-[180px]"
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
            onBlur={() => undefined}
          />

          <DetailsTextArea
            label="Post-request Script"
            value={draft.postRequestScript}
            minHeightClassName="min-h-[180px]"
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
            onBlur={() => undefined}
          />
        </div>
      </section>

      <section className="w-full px-8 py-6">
        <div className="mb-4 text-sm text-base-content/55">Response</div>
        <div className="grid gap-4 md:grid-cols-3">
          <EmptyPanel title="Status" description="Response status will appear here." />
          <EmptyPanel title="Headers" description="Response headers will appear here." />
          <EmptyPanel title="Body" description="Response body will appear here." />
        </div>
      </section>
    </>
  )
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="min-h-32 border border-dashed border-base-content/12 bg-base-100/35 px-4 py-4">
      <div className="text-sm font-medium text-base-content">{title}</div>
      <div className="mt-2 text-sm text-base-content/50">{description}</div>
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
        className={['textarea w-full rounded-none border-base-content/10 bg-base-100/70 font-mono text-sm leading-6', minHeightClassName].join(' ')}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </section>
  )
}
