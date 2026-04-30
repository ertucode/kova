import { useEffect, useMemo, useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import type { SharedScriptRecord, SharedScriptScopeType, SharedScriptTarget } from '@common/SharedScripts'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { CodeEditor } from './CodeEditor'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { useScopedSharedScripts } from './useVisibleSharedScripts'

const SCRIPT_TARGET_OPTIONS: SharedScriptTarget[] = ['pre-request', 'post-request', 'response-visualizer']

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

  const handleCreate = async (kind: SharedScriptRecord['kind']) => {
    const result = await getWindowElectron().createSharedScript({
      scopeType,
      scopeId,
      name: '',
      kind,
      isActive: kind === 'global',
      targets: ['pre-request'],
      code: '',
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    await reload()
    onScriptsChanged?.()
  }

  return (
    <section className="bg-base-200/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-base-content">{title}</div>
          <p className="mt-1 max-w-3xl text-sm text-base-content/60">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void handleCreate('global')}>
            Add Global
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleCreate('module')}>
            Add Module
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {loading && scripts.length === 0 ? (
          <div className="text-sm text-base-content/55">Loading shared scripts...</div>
        ) : null}
        {!loading && scripts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-base-content/15 px-4 py-5 text-sm text-base-content/55">
            No shared scripts in this scope.
          </div>
        ) : null}

        {scripts.map(script => (
          <SharedScriptCard
            key={script.id}
            script={script}
            visibleSharedScripts={visibleSharedScripts}
            onChanged={async () => {
              await reload()
              onScriptsChanged?.()
            }}
          />
        ))}
      </div>
    </section>
  )
}

function SharedScriptCard({
  script,
  visibleSharedScripts,
  onChanged,
}: {
  script: SharedScriptRecord
  visibleSharedScripts: SharedScriptRecord[]
  onChanged: () => Promise<void>
}) {
  const [draft, setDraft] = useState(script)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setDraft(script)
  }, [script])

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

  const handleSave = async () => {
    setSaving(true)

    try {
      const result = await getWindowElectron().updateSharedScript({
        id: draft.id,
        name: draft.name,
        kind: draft.kind,
        targets: draft.targets,
        isActive: draft.isActive,
        code: draft.code,
      })

      if (!result.success) {
        toast.show(result)
        return
      }

      toast.show({ severity: 'success', message: 'Shared script saved.' })
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)

    try {
      const result = await getWindowElectron().deleteSharedScript({ id: draft.id })
      if (!result.success) {
        toast.show(result)
        return
      }

      await onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-content/10 px-4 py-3">
        <input
          type="text"
          className="input input-sm min-w-[200px] flex-1 rounded-lg border-base-content/10 bg-base-100"
          value={draft.name}
          placeholder={draft.kind === 'module' ? 'Module name (required)' : 'Optional name'}
          onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
        />

        <select
          className="select select-sm rounded-lg border-base-content/10 bg-base-100"
          value={draft.kind}
          onChange={event =>
            setDraft(current => ({
              ...current,
              kind: event.target.value === 'global' ? 'global' : 'module',
            }))
          }
        >
          <option value="global">Global</option>
          <option value="module">Module</option>
        </select>

        <label className="inline-flex items-center gap-2 text-sm text-base-content/70">
          <input
            type="checkbox"
            className="checkbox checkbox-sm rounded-md"
            checked={draft.isActive}
            onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))}
          />
          Active
        </label>

        <button
          type="button"
          className="btn btn-sm btn-ghost text-error"
          onClick={() => void handleDelete()}
          disabled={deleting}
        >
          <Trash2Icon className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-base-content/10 px-4 py-3">
        {SCRIPT_TARGET_OPTIONS.map(target => {
          const disabled =
            target === 'response-visualizer' ? draft.targets.length > 1 && !draft.targets.includes(target) : false

          return (
            <label
              key={target}
              className="inline-flex items-center gap-2 rounded-lg border border-base-content/10 px-3 py-1.5 text-sm text-base-content/70"
            >
              <input
                type="checkbox"
                className="checkbox checkbox-xs rounded-sm"
                checked={draft.targets.includes(target)}
                disabled={disabled}
                onChange={event => {
                  const checked = event.target.checked
                  setDraft(current => {
                    const nextTargets = checked
                      ? target === 'response-visualizer'
                        ? ['response-visualizer']
                        : current.targets.includes('response-visualizer')
                          ? [target]
                          : [...current.targets, target]
                      : current.targets.filter(currentTarget => currentTarget !== target)

                    return {
                      ...current,
                      targets: (nextTargets.length > 0 ? nextTargets : [target]) as SharedScriptTarget[],
                    }
                  })
                }}
              />
              <span>{target}</span>
            </label>
          )
        })}
      </div>

      <div className="h-[260px]">
        <CodeEditor
          value={draft.code}
          language={phase === 'response-visualizer' ? 'jsx' : 'javascript'}
          size="small"
          showLineNumbers
          minHeightClassName="min-h-full h-full"
          className="h-full border-x-0 border-b-0 border-t-0"
          extensions={extensions}
          onChange={value => setDraft(current => ({ ...current, code: value }))}
          onBlur={() => undefined}
        />
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-base-content/10 px-4 py-3">
        <div className="text-xs text-base-content/45">
          {draft.kind === 'module'
            ? 'Modules are loaded with requireScript(name) and must use explicit exports.'
            : 'Active globals auto-run and expose their top-level declarations to other scripts.'}
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
          Save
        </button>
      </div>
    </div>
  )
}
