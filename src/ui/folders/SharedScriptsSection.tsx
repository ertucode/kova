import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useSelector } from '@xstate/store/react'
import { FileBracesIcon, Trash2Icon } from 'lucide-react'
import type { SharedScriptRecord, SharedScriptScopeType, SharedScriptTarget } from '@common/SharedScripts'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { ChangesCoordinator } from './changesCoordinator'
import { CodeEditor } from './CodeEditor'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import {
  getSharedScriptScopeKey,
  isSharedScriptEntryDirty,
  sharedScriptEditorStore,
  type SharedScriptEditorSelection,
} from './sharedScriptEditorStore'
import { notifySharedScriptsChanged, useScopedSharedScripts } from './useVisibleSharedScripts'

const SCRIPT_TARGET_OPTIONS: SharedScriptTarget[] = ['pre-request', 'post-request', 'response-visualizer']
const EMPTY_ENTRIES: Record<string, never> = {}

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
  const { scripts, loading, hasLoaded, reload } = useScopedSharedScripts(scopeType, scopeId)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const scopeKey = getSharedScriptScopeKey(scopeType, scopeId)
  const selectedId = useSelector(sharedScriptEditorStore, state => state.context.selectedIdsByScope[scopeKey] ?? null)
  const focusScriptId = useSelector(sharedScriptEditorStore, state => state.context.focusIdsByScope[scopeKey] ?? null)
  const entries = useSelector(sharedScriptEditorStore, state => state.context.entriesByScope[scopeKey] ?? EMPTY_ENTRIES)

  useEffect(() => {
    if (!hasLoaded) {
      return
    }

    sharedScriptEditorStore.trigger.scriptsLoaded({ scopeKey, items: scripts })
  }, [hasLoaded, scopeKey, scripts])

  useEffect(() => {
    if (!hasLoaded) {
      return
    }

    if (scripts.length === 0) {
      if (selectedId !== null) {
        sharedScriptEditorStore.trigger.selectedChanged({ scopeKey, id: null })
      }
      return
    }

    if (!selectedId || !scripts.some(script => script.id === selectedId)) {
      sharedScriptEditorStore.trigger.selectedChanged({ scopeKey, id: scripts[0]?.id ?? null })
    }
  }, [hasLoaded, scopeKey, scripts, selectedId])

  useEffect(() => {
    if (!selectedId || focusScriptId !== selectedId) {
      return
    }

    nameInputRef.current?.focus()
    nameInputRef.current?.select()
    sharedScriptEditorStore.trigger.focusHandled({ scopeKey })
  }, [focusScriptId, scopeKey, selectedId])

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

    await reloadAll()
    sharedScriptEditorStore.trigger.selectedChanged({ scopeKey, id: result.data.id })
    sharedScriptEditorStore.trigger.focusRequested({ scopeKey, id: result.data.id })
  }

  function updateDraft(id: string, draftValue: SharedScriptRecord) {
    sharedScriptEditorStore.trigger.draftUpdated({ scopeKey, id, draft: draftValue })
  }

  function updateSelection(id: string, selection: SharedScriptEditorSelection) {
    sharedScriptEditorStore.trigger.selectionUpdated({ scopeKey, id, selection })
  }

  async function saveScript(id: string, overrideDraft?: SharedScriptRecord) {
    const entry = entries[id]
    const draftValue = overrideDraft ?? entry?.current
    if (!entry || !draftValue) {
      return
    }

    sharedScriptEditorStore.trigger.entrySavingStarted({ scopeKey, id, draft: draftValue })

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
      sharedScriptEditorStore.trigger.entrySavingFinished({ scopeKey, id })
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

    sharedScriptEditorStore.trigger.itemDeleted({ scopeKey, id, nextSelectedId })
    await reloadAll()
    notifySharedScriptsChanged()
    void ChangesCoordinator.loadOperations()
    toast.show({
      severity: 'info',
      title: result.data.operation.title,
      timeout: 5000,
      actionLabel: 'Undo',
      onAction: () => {
        void (async () => {
          const undoResult = await getWindowElectron().undoOperation({ id: result.data.operation.id })
          if (!undoResult.success) {
            toast.show(undoResult)
            return
          }

          await reloadAll()
          notifySharedScriptsChanged()
          void ChangesCoordinator.loadOperations()
          toast.show({ severity: 'success', title: 'Change undone', message: undoResult.data.title })
        })()
      },
    })
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
                  onClick={() => sharedScriptEditorStore.trigger.selectedChanged({ scopeKey, id: item.id })}
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
            selection={selectedEntry?.selection ?? null}
            nameInputRef={nameInputRef}
            onChange={nextDraft => updateDraft(selectedId, nextDraft)}
            onSelectionChange={selection => updateSelection(selectedId, selection)}
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
  selection,
  nameInputRef,
  onChange,
  onSelectionChange,
  onDelete,
  onSave,
}: {
  draft: SharedScriptRecord
  visibleSharedScripts: SharedScriptRecord[]
  isDirty: boolean
  isSaving: boolean
  selection: SharedScriptEditorSelection | null
  nameInputRef: RefObject<HTMLInputElement | null>
  onChange: (draft: SharedScriptRecord) => void
  onSelectionChange: (selection: SharedScriptEditorSelection) => void
  onDelete: () => void
  onSave: () => void
}) {
  const targets = useMemo(() => normalizeSharedScriptTargets(draft.targets), [draft.targets])
  const isVisualizerOnly = targets.length === 1 && targets[0] === 'response-visualizer'

  const autocompleteSharedScripts = useMemo(
    () => visibleSharedScripts.filter(item => item.id !== draft.id),
    [draft.id, visibleSharedScripts]
  )

  const extensions = useMemo(
    () => [
      scriptDiagnosticsExtension({ targets, getSharedScripts: () => autocompleteSharedScripts }),
      scriptAutocompleteExtension({
        includeResponse: false,
        targets,
        getSharedScripts: () => autocompleteSharedScripts,
      }),
    ],
    [autocompleteSharedScripts, targets]
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
                return (
                  <label
                    key={target}
                    className={[
                      'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
                       draft.targets.includes(target)
                          ? 'border-primary/30 bg-primary/10 text-base-content'
                          : 'border-base-content/10 bg-base-100 text-base-content/70',
                     ].join(' ')}
                   >
                     <input
                       type="checkbox"
                       className="checkbox checkbox-xs rounded-sm"
                       checked={draft.targets.includes(target)}
                       onChange={event => {
                         const checked = event.target.checked
                         const nextTargets = checked
                           ? normalizeSharedScriptTargets([...draft.targets, target])
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
          language={isVisualizerOnly ? 'jsx' : 'javascript'}
          size="small"
          showLineNumbers
          minHeightClassName="min-h-full h-full"
          className="h-full border-x-0 border-b-0 border-t-0"
          extensions={extensions}
          onChange={value => onChange({ ...draft, code: value })}
          onSelectionChange={onSelectionChange}
          initialSelection={selection}
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

function normalizeSharedScriptTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets))
}
