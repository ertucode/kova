import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { FlaskConicalIcon, Trash2Icon } from 'lucide-react'
import { normalizeEnvironmentColor } from '@common/Environments'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { environmentEditorStore } from './environmentEditorStore'
import { KeyValueEditor } from './KeyValueEditor'

export function FolderEnvironmentsSection({ folderId }: { folderId: string }) {
  const items = useSelector(environmentEditorStore, state => state.context.items)
  const entries = useSelector(environmentEditorStore, state => state.context.entries)
  const focusEnvironmentId = useSelector(environmentEditorStore, state => state.context.focusEnvironmentId)
  const folderItems = items.filter(item => item.folderId === folderId)
  const [selectedId, setSelectedId] = useState<string | null>(folderItems[0]?.id ?? null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selectedId && folderItems.some(item => item.id === selectedId)) {
      return
    }

    setSelectedId(folderItems[0]?.id ?? null)
  }, [folderItems, selectedId])

  useEffect(() => {
    if (!focusEnvironmentId || !folderItems.some(item => item.id === focusEnvironmentId)) {
      return
    }

    setSelectedId(focusEnvironmentId)
  }, [folderItems, focusEnvironmentId])

  const entry = selectedId ? (entries[selectedId] ?? null) : null
  const draft = entry?.current ?? null
  const draftColorValue = draft?.color ?? '#64748b'

  useEffect(() => {
    if (!selectedId || focusEnvironmentId !== selectedId || !draft) {
      return
    }

    nameInputRef.current?.focus()
    nameInputRef.current?.select()
    environmentEditorStore.trigger.focusHandled()
  }, [draft, focusEnvironmentId, selectedId])

  return (
    <div className="flex h-[500px] min-h-[500px] min-w-0 overflow-hidden rounded-none border border-base-content/10 bg-base-100">
      <aside className="flex w-[300px] min-w-[300px] flex-col border-r border-base-content/10 bg-base-100">
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {folderItems.length === 0 ? (
            <div className="px-1 py-3 text-sm text-base-content/45">No folder environments yet.</div>
          ) : (
            <div className="space-y-2">
              {folderItems.map(item => {
                const isSelected = item.id === selectedId

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={[
                      'flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition',
                      isSelected
                        ? 'border-primary/35 bg-primary/10 text-base-content'
                        : 'border-base-content/10 bg-base-100 text-base-content/80 hover:border-base-content/20 hover:bg-base-200/70',
                    ].join(' ')}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{item.name}</div>
                      <div className="mt-1 text-xs text-base-content/45">Priority {item.priority}</div>
                    </div>

                    {item.color ? (
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-base-content/10"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </aside>

      <section className="min-h-0 min-w-0 flex-1 overflow-auto bg-base-100">
        {draft && selectedId ? (
          <div className="min-h-full">
            <div className="border-b border-base-content/10 px-6 pt-5 pb-0">
              <div className="flex items-center gap-4">
                <div className="group relative shrink-0 rounded-2xl border border-base-content/10 bg-base-100 p-3 text-base-content/60">
                  <FlaskConicalIcon className="size-5 transition group-hover:opacity-0" />
                  <button
                    type="button"
                    className="absolute inset-0 flex items-center justify-center rounded-2xl text-base-content/65 opacity-0 transition group-hover:opacity-100 hover:bg-error/12 hover:text-error"
                    onClick={() =>
                      EnvironmentCoordinator.requestDeleteEnvironment(selectedId, draft.name || 'Untitled environment')
                    }
                    aria-label="Delete environment"
                    title="Delete environment"
                  >
                    <Trash2Icon className="size-4" />
                  </button>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    ref={nameInputRef}
                    className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-semibold tracking-tight text-base-content outline-none"
                    value={draft.name}
                    placeholder="Environment name"
                    onChange={event =>
                      EnvironmentCoordinator.updateDraft(selectedId, { ...draft, name: event.target.value })
                    }
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-col divide-y divide-base-content/10 border-t border-base-content/10">
                <label className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-base-content">Warn before request</div>
                    <div className="mt-1 text-sm leading-6 text-base-content/55">
                      Show a confirmation before sending when this environment applies and the app-level warning
                      threshold is exceeded.
                    </div>
                  </div>

                  <div className="flex justify-start md:justify-end">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={draft.warnOnRequest}
                      onChange={event =>
                        EnvironmentCoordinator.updateDraft(selectedId, {
                          ...draft,
                          warnOnRequest: event.target.checked,
                        })
                      }
                      onBlur={() => void EnvironmentCoordinator.saveEnvironment(selectedId)}
                    />
                  </div>
                </label>

                <label className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-base-content">Priority</div>
                    <div className="mt-1 text-sm text-base-content/55">
                      Higher priority wins when variables overlap inside the same scope.
                    </div>
                  </div>

                  <input
                    type="number"
                    className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100 md:w-[180px]"
                    value={draft.priority}
                    onChange={event =>
                      EnvironmentCoordinator.updateDraft(selectedId, {
                        ...draft,
                        priority: Number.isNaN(event.target.valueAsNumber) ? 0 : Math.trunc(event.target.valueAsNumber),
                      })
                    }
                  />
                </label>

                <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-base-content">Color</div>
                    <div className="mt-1 text-sm text-base-content/55">
                      Use a custom accent to make the environment easier to spot.
                    </div>
                  </div>

                  <div className="flex w-full items-center gap-3 md:w-auto md:min-w-[280px] md:justify-end">
                    <input
                      type="color"
                      className="h-10 w-16 cursor-pointer appearance-none rounded-xl border-0 bg-transparent p-0"
                      value={draftColorValue}
                      onChange={event => {
                        EnvironmentCoordinator.updateDraft(selectedId, {
                          ...draft,
                          color: normalizeEnvironmentColor(event.target.value),
                        })
                        void EnvironmentCoordinator.saveEnvironment(selectedId)
                      }}
                      aria-label="Environment color"
                    />
                    <div className="min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5 text-sm text-base-content/70 md:max-w-[180px]">
                      {draft.color ?? 'No custom color'}
                    </div>
                    {draft.color ? (
                      <button
                        type="button"
                        className="rounded-xl border border-base-content/10 px-3 py-2 text-sm text-base-content/65 transition hover:border-base-content/20 hover:bg-base-200 hover:text-base-content"
                        onClick={() => {
                          EnvironmentCoordinator.updateDraft(selectedId, {
                            ...draft,
                            color: null,
                          })
                          void EnvironmentCoordinator.saveEnvironment(selectedId)
                        }}
                        title="Clear custom color"
                        aria-label="Clear custom color"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <KeyValueEditor
              key={selectedId}
              label={null}
              value={draft.variables}
              onChange={value => EnvironmentCoordinator.updateDraft(selectedId, { ...draft, variables: value })}
              keyPlaceholder="variable_name"
              valuePlaceholder="value"
              descriptionPlaceholder="Optional note"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-sm text-base-content/45">
            Select a folder environment
          </div>
        )}
      </section>
    </div>
  )
}
