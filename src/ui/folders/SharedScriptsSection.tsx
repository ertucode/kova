import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { FileBracesIcon, Trash2Icon } from 'lucide-react'
import type { SharedScriptRecord, SharedScriptScopeType, SharedScriptTarget } from '@common/SharedScripts'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { CodeEditor } from './CodeEditor'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { useScopedSharedScripts } from './useVisibleSharedScripts'

const SCRIPT_TARGET_OPTIONS: SharedScriptTarget[] = ['pre-request', 'post-request', 'response-visualizer']

type SharedScriptEntry = {
  base: SharedScriptRecord
  current: SharedScriptRecord
  saving: boolean
}

export function SharedScriptsSection({
  title,
  description,
  scopeType,
  scopeId,
  visibleSharedScripts,
  onScriptsChanged,
}: {
  title: string
  description: string
  scopeType: SharedScriptScopeType
  scopeId: string | null
  visibleSharedScripts: SharedScriptRecord[]
  onScriptsChanged?: () => void
}) {
  const { scripts, loading, reload } = useScopedSharedScripts(scopeType, scopeId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, SharedScriptEntry>>({})
  const [focusScriptId, setFocusScriptId] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setEntries(currentEntries => {
      const nextEntries: Record<string, SharedScriptEntry> = {}

      for (const script of scripts) {
        const existing = currentEntries[script.id]
        if (!existing) {
          nextEntries[script.id] = { base: script, current: script, saving: false }
          continue
        }

        nextEntries[script.id] = {
          base: script,
          current: isSharedScriptEntryDirty(existing) ? existing.current : script,
          saving: existing.saving,
        }
      }

      return nextEntries
    })
  }, [scripts])

  useEffect(() => {
    if (scripts.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null)
      }
      return
    }

    if (!selectedId || !scripts.some(script => script.id === selectedId)) {
      setSelectedId(scripts[0]?.id ?? null)
    }
  }, [scripts, selectedId])

  useEffect(() => {
    if (!selectedId || focusScriptId !== selectedId) {
      return
    }

    nameInputRef.current?.focus()
    nameInputRef.current?.select()
    setFocusScriptId(null)
  }, [focusScriptId, selectedId])

  const items = useMemo(() => scripts.map(script => entries[script.id]?.current ?? script), [entries, scripts])
  const selectedEntry = selectedId ? (entries[selectedId] ?? null) : null
  const draft = selectedEntry?.current ?? null
  const isDirty = isSharedScriptEntryDirty(selectedEntry)
  const isSaving = Boolean(selectedEntry?.saving)

  async function reloadAll() {
    await reload()
    onScriptsChanged?.()
  }

  const handleCreate = async (kind: SharedScriptRecord['kind']) => {
    const result = await getWindowElectron().createSharedScript({
      scopeType,
      scopeId,
      name: buildNewScriptName(kind, items),
      kind,
      isActive: kind === 'global',
      targets: ['pre-request'],
      code: '',
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    setSelectedId(result.data.id)
    setFocusScriptId(result.data.id)
    await reloadAll()
  }

  function updateDraft(id: string, draftValue: SharedScriptRecord) {
    setEntries(currentEntries => {
      const entry = currentEntries[id]
      if (!entry) {
        return currentEntries
      }

      return {
        ...currentEntries,
        [id]: {
          ...entry,
          current: draftValue,
        },
      }
    })
  }

  async function saveScript(id: string, overrideDraft?: SharedScriptRecord) {
    const entry = entries[id]
    const draftValue = overrideDraft ?? entry?.current
    if (!entry || !draftValue) {
      return
    }

    setEntries(currentEntries => ({
      ...currentEntries,
      [id]: {
        ...currentEntries[id],
        current: draftValue,
        saving: true,
      },
    }))

    try {
      const result = await getWindowElectron().updateSharedScript({
        id: draftValue.id,
        name: draftValue.name,
        kind: draftValue.kind,
        targets: draftValue.targets,
        isActive: draftValue.isActive,
        code: draftValue.code,
      })

      if (!result.success) {
        toast.show(result)
        return
      }

      await reloadAll()
    } finally {
      setEntries(currentEntries => {
        const currentEntry = currentEntries[id]
        if (!currentEntry) {
          return currentEntries
        }

        return {
          ...currentEntries,
          [id]: {
            ...currentEntry,
            saving: false,
          },
        }
      })
    }
  }

  async function deleteScript(id: string) {
    const currentIndex = items.findIndex(script => script.id === id)
    const nextSelectedId = items[currentIndex + 1]?.id ?? items[currentIndex - 1]?.id ?? null
    const result = await getWindowElectron().deleteSharedScript({ id })
    if (!result.success) {
      toast.show(result)
      return
    }

    setSelectedId(nextSelectedId)
    await reloadAll()
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-base-100 h-full">
      <aside className="flex w-[320px] min-w-[320px] flex-col border-r border-base-content/10 bg-base-100">
        <div className="border-b border-base-content/10 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-base-content">{title}</div>
              {description ? <p className="mt-1 text-sm text-base-content/60">{description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                className="flex h-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm font-medium text-base-content transition hover:border-base-content/20 hover:bg-base-200"
                onClick={() => void handleCreate('global')}
              >
                Add Global
              </button>
              <button
                type="button"
                className="flex h-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm font-medium text-base-content transition hover:border-base-content/20 hover:bg-base-200"
                onClick={() => void handleCreate('module')}
              >
                Add Module
              </button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          {loading ? <div className="px-1 py-3 text-sm text-base-content/45">Loading shared scripts...</div> : null}

          {!loading && items.length === 0 ? (
            <div className="px-1 py-3 text-sm text-base-content/45">No shared scripts in this scope.</div>
          ) : null}

          <div className="space-y-2">
            {items.map(item => {
              const entry = entries[item.id]
              const itemIsDirty = isSharedScriptEntryDirty(entry)
              const itemIsSaving = Boolean(entry?.saving)
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
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium">{item.name || getUntitledLabel(item.kind)}</div>
                      {itemIsSaving || itemIsDirty ? (
                        <SaveIndicator isDirty={itemIsDirty} isSaving={itemIsSaving} labelPrefix="Script" />
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-xs text-base-content/45">{formatScriptMeta(item)}</div>
                  </div>

                  <button
                    type="button"
                    className={
                      item.isActive
                        ? 'rounded-full bg-success/15 px-2 py-1 text-[11px] font-medium text-success'
                        : 'rounded-full bg-base-content/8 px-2 py-1 text-[11px] font-medium text-base-content/45'
                    }
                    onClick={event => {
                      event.stopPropagation()
                      void saveScript(item.id, {
                        ...item,
                        isActive: !item.isActive,
                      })
                    }}
                    aria-pressed={item.isActive}
                    title={item.isActive ? 'Deactivate shared script' : 'Activate shared script'}
                  >
                    {item.isActive ? 'Active' : 'Inactive'}
                  </button>
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <section className="min-h-0 min-w-0 flex-1 overflow-auto bg-base-100">
        {draft && selectedId ? (
          <SharedScriptDetail
            draft={draft}
            visibleSharedScripts={visibleSharedScripts}
            isDirty={isDirty}
            isSaving={isSaving}
            nameInputRef={nameInputRef}
            onChange={nextDraft => updateDraft(selectedId, nextDraft)}
            onDelete={() => void deleteScript(selectedId)}
            onSave={() => void saveScript(selectedId)}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-sm text-base-content/45">
            Select a shared script
          </div>
        )}
      </section>
    </section>
  )
}

function SharedScriptDetail({
  draft,
  visibleSharedScripts,
  isDirty,
  isSaving,
  nameInputRef,
  onChange,
  onDelete,
  onSave,
}: {
  draft: SharedScriptRecord
  visibleSharedScripts: SharedScriptRecord[]
  isDirty: boolean
  isSaving: boolean
  nameInputRef: RefObject<HTMLInputElement | null>
  onChange: (draft: SharedScriptRecord) => void
  onDelete: () => void
  onSave: () => void
}) {
  const phase = useMemo(() => {
    if (draft.targets.includes('response-visualizer')) {
      return 'response-visualizer' as const
    }

    return draft.targets.includes('pre-request') ? ('pre-request' as const) : ('post-request' as const)
  }, [draft.targets])

  const autocompleteSharedScripts = useMemo(
    () => visibleSharedScripts.map(item => (item.id === draft.id ? draft : item)),
    [draft, visibleSharedScripts]
  )

  const extensions = useMemo(
    () => [
      scriptDiagnosticsExtension({ phase, getSharedScripts: () => autocompleteSharedScripts }),
      scriptAutocompleteExtension({
        includeResponse: phase === 'post-request',
        phase,
        getSharedScripts: () => autocompleteSharedScripts,
      }),
    ],
    [autocompleteSharedScripts, phase]
  )

  return (
    <div className="min-h-full">
      <div className="border-b border-base-content/10 px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="group relative shrink-0 rounded-2xl border border-base-content/10 bg-base-100 px-4 py-3 text-sm font-medium text-base-content/60">
            <FileBracesIcon className="size-4" />
            <button
              type="button"
              className="absolute inset-0 flex items-center justify-center rounded-2xl text-base-content/65 opacity-0 transition group-hover:opacity-100 hover:bg-error/12 hover:text-error"
              onClick={onDelete}
              aria-label="Delete shared script"
              title="Delete shared script"
            >
              <Trash2Icon className="size-4" />
            </button>
          </div>

          <div className="min-w-0 flex flex-1 items-center gap-3">
            <input
              ref={nameInputRef}
              className="w-full border-0 bg-transparent px-0 py-0.5 text-3xl font-semibold tracking-tight text-base-content outline-none"
              value={draft.name}
              placeholder={draft.kind === 'module' ? 'Module name' : 'Global script name'}
              onChange={event => onChange({ ...draft, name: event.target.value })}
            />
            <SaveIndicator isDirty={isDirty} isSaving={isSaving} labelPrefix="Script" />
            <button
              type="button"
              className="flex h-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 px-4 text-sm font-medium text-base-content transition hover:border-base-content/20 hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onSave}
              disabled={isSaving || !isDirty}
            >
              Save
            </button>
          </div>
        </div>

        <div className="mt-6 flex flex-col divide-y divide-base-content/10 border-t border-base-content/10">
          <label className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-base-content">Type</div>
              <div className="mt-1 text-sm text-base-content/55">
                Globals auto-run in their target phases. Modules are loaded manually with `requireScript(name)`.
              </div>
            </div>

            <select
              className="select h-11 w-full rounded-xl border-base-content/10 bg-base-100 md:w-[180px]"
              value={draft.kind}
              onChange={event =>
                onChange({
                  ...draft,
                  kind: event.target.value === 'global' ? 'global' : 'module',
                })
              }
            >
              <option value="global">Global</option>
              <option value="module">Module</option>
            </select>
          </label>

          <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="text-sm font-medium text-base-content">Targets</div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              {SCRIPT_TARGET_OPTIONS.map(target => {
                const disabled =
                  target === 'response-visualizer' ? draft.targets.length > 1 && !draft.targets.includes(target) : false

                return (
                  <label
                    key={target}
                    className={[
                      'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                      draft.targets.includes(target)
                        ? 'border-primary/30 bg-primary/10 text-base-content'
                        : 'border-base-content/10 bg-base-100 text-base-content/70',
                      disabled ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs rounded-sm"
                      checked={draft.targets.includes(target)}
                      disabled={disabled}
                      onChange={event => {
                        const checked = event.target.checked
                        const nextTargets = checked
                          ? target === 'response-visualizer'
                            ? ['response-visualizer']
                            : draft.targets.includes('response-visualizer')
                              ? [target]
                              : [...draft.targets, target]
                          : draft.targets.filter(currentTarget => currentTarget !== target)

                        onChange({
                          ...draft,
                          targets: (nextTargets.length > 0 ? nextTargets : [target]) as SharedScriptTarget[],
                        })
                      }}
                    />
                    <span>{formatTargetLabel(target)}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="h-[420px] min-h-[360px]">
        <CodeEditor
          value={draft.code}
          language={phase === 'response-visualizer' ? 'jsx' : 'javascript'}
          size="small"
          showLineNumbers
          minHeightClassName="min-h-full h-full"
          className="h-full border-x-0 border-b-0 border-t-0"
          extensions={extensions}
          onChange={value => onChange({ ...draft, code: value })}
          onBlur={() => undefined}
        />
      </div>
    </div>
  )
}

function SaveIndicator({
  isDirty,
  isSaving,
  labelPrefix,
}: {
  isDirty: boolean
  isSaving: boolean
  labelPrefix: string
}) {
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
      aria-label={
        isSaving
          ? `Saving ${labelPrefix.toLowerCase()}`
          : isDirty
            ? `${labelPrefix} has unsaved changes`
            : `${labelPrefix} is saved`
      }
      title={
        isSaving
          ? `Saving ${labelPrefix.toLowerCase()}`
          : isDirty
            ? `${labelPrefix} has unsaved changes`
            : `${labelPrefix} is saved`
      }
    />
  )
}

function buildNewScriptName(kind: SharedScriptRecord['kind'], scripts: SharedScriptRecord[]) {
  const prefix = kind === 'global' ? 'Global Script' : 'Module Script'
  const usedNames = new Set(scripts.map(script => script.name.trim()).filter(Boolean))

  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${prefix} ${index}`
    if (!usedNames.has(candidate)) {
      return candidate
    }
  }

  return `${prefix} ${Date.now()}`
}

function isSharedScriptEntryDirty(entry: SharedScriptEntry | null | undefined) {
  if (!entry) {
    return false
  }

  return serializeSharedScript(entry.base) !== serializeSharedScript(entry.current)
}

function serializeSharedScript(script: SharedScriptRecord) {
  return JSON.stringify({
    name: script.name,
    kind: script.kind,
    targets: script.targets,
    isActive: script.isActive,
    code: script.code,
  })
}

function formatScriptMeta(script: SharedScriptRecord) {
  return `${script.kind === 'global' ? 'Global' : 'Module'} · ${script.targets.map(formatTargetLabel).join(', ')}`
}

function formatTargetLabel(target: SharedScriptTarget) {
  if (target === 'pre-request') {
    return 'Pre-request'
  }

  if (target === 'post-request') {
    return 'Post-request'
  }

  return 'Response visualizer'
}

function getUntitledLabel(kind: SharedScriptRecord['kind']) {
  return kind === 'global' ? 'Untitled global script' : 'Untitled module script'
}
