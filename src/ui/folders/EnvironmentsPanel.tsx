import { useEffect, useRef } from 'react'
import { useSelector } from '@xstate/store/react'
import { FlaskConicalIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { environmentEditorStore, isEnvironmentEntryDirty } from './environmentEditorStore'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { KeyValueEditor } from './KeyValueEditor'

export function EnvironmentsPanel() {
  const items = useSelector(environmentEditorStore, state => state.context.items)
  const selectedId = useSelector(environmentEditorStore, state => state.context.selectedId)
  const focusEnvironmentId = useSelector(environmentEditorStore, state => state.context.focusEnvironmentId)
  const loading = useSelector(environmentEditorStore, state => state.context.loading)
  const entry = useSelector(environmentEditorStore, state =>
    state.context.selectedId ? (state.context.entries[state.context.selectedId] ?? null) : null
  )
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)

  const draft = entry?.current ?? null
  const isDirty = isEnvironmentEntryDirty(entry)
  const isSaving = Boolean(entry?.saving)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!selectedId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void EnvironmentCoordinator.saveEnvironment(selectedId)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId])

  useEffect(() => {
    if (!draft || !selectedId || focusEnvironmentId !== selectedId) {
      return
    }

    nameInputRef.current?.focus()
    nameInputRef.current?.select()
    environmentEditorStore.trigger.focusHandled()
  }, [draft, focusEnvironmentId, selectedId])

  return (
    <div className="flex min-h-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[340px] min-w-[340px] flex-col border-r border-base-content/10 bg-base-100">
        <div className="border-b border-base-content/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-base-content">Environments</div>

            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 text-base-content transition hover:border-base-content/20 hover:bg-base-200"
              onClick={() => void EnvironmentCoordinator.createEnvironment()}
              aria-label="Add environment"
              title="Add environment"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {loading ? <div className="px-1 py-3 text-sm text-base-content/45">Loading environments...</div> : null}

          {!loading && items.length === 0 ? (
            <div className="px-1 py-3 text-sm text-base-content/45">No environments yet.</div>
          ) : null}

          <div className="space-y-2">
            {items.map(item => {
              const isActive = activeEnvironmentIds.includes(item.id)
              const isSelected = item.id === selectedId

              return (
                <div
                  key={item.id}
                  className={[
                    'flex items-center gap-3 rounded-2xl border px-3 py-3 transition',
                    isSelected
                      ? 'border-primary/35 bg-primary/10 text-base-content'
                      : 'border-base-content/10 bg-base-100 text-base-content/80 hover:border-base-content/20 hover:bg-base-200/70',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => EnvironmentCoordinator.selectEnvironment(item.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-base-content/45">Priority {item.priority}</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={isActive ? 'rounded-full bg-success/15 px-2 py-1 text-[11px] font-medium text-success' : 'rounded-full bg-base-content/8 px-2 py-1 text-[11px] font-medium text-base-content/45'}
                    onClick={() => EnvironmentCoordinator.toggleActiveEnvironment(item.id)}
                    aria-pressed={isActive}
                    title={isActive ? 'Deactivate environment' : 'Activate environment'}
                  >
                    {isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      <section className="min-h-0 flex-1 overflow-auto bg-base-100">
        {draft && selectedId ? (
          <div className="min-h-full">
            <div className="border-b border-base-content/10 px-6 py-5">
              <div className="flex items-center gap-4">
                <div className="group relative shrink-0 rounded-2xl border border-base-content/10 bg-base-100 p-3 text-base-content/60">
                  <FlaskConicalIcon className="size-5 transition group-hover:opacity-0" />
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center rounded-2xl text-base-content/65 opacity-0 transition group-hover:opacity-100 hover:bg-error/12 hover:text-error"
                    onClick={() => EnvironmentCoordinator.requestDeleteEnvironment(selectedId, draft.name || 'Untitled environment')}
                    aria-label="Delete environment"
                    title="Delete environment"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </div>

                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <input
                    ref={nameInputRef}
                    className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-semibold tracking-tight text-base-content outline-none"
                    value={draft.name}
                    placeholder="Environment name"
                    onChange={event => EnvironmentCoordinator.updateDraft(selectedId, { ...draft, name: event.target.value })}
                  />
                  <SaveIndicator isDirty={isDirty} isSaving={isSaving} />
                </div>
              </div>

              <div className="mt-5 flex items-end gap-3">
                <label className="block w-[180px] max-w-full">
                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Priority</div>
                  <input
                    type="number"
                    className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
                    value={draft.priority}
                    onChange={event =>
                      EnvironmentCoordinator.updateDraft(selectedId, {
                        ...draft,
                        priority: Number.isNaN(event.target.valueAsNumber) ? 0 : Math.trunc(event.target.valueAsNumber),
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <KeyValueEditor
              label={null}
              value={draft.variables}
              onChange={value => EnvironmentCoordinator.updateDraft(selectedId, { ...draft, variables: value })}
              keyPlaceholder="variable_name"
              valuePlaceholder="value"
              descriptionPlaceholder="Optional note"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-sm text-base-content/45">Select an environment</div>
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
      aria-label={isSaving ? 'Saving environment' : isDirty ? 'Environment has unsaved changes' : 'Environment is saved'}
      title={isSaving ? 'Saving environment' : isDirty ? 'Environment has unsaved changes' : 'Environment is saved'}
    />
  )
}
