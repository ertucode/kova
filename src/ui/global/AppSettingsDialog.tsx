import { useEffect, useState } from 'react'
import type { GenericResult } from '@common/GenericError'
import { errorResponseToMessage } from '@common/GenericError'
import { useSelector } from '@xstate/store/react'
import { APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES } from '@common/AppSettings'
import type { DatabaseConfigState } from '@common/DatabaseConfigs'
import { getWindowElectron } from '@/getWindowElectron'
import { Dialog } from '@/lib/components/dialog'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { dialogActions } from './dialogStore'
import { AppSettingsCoordinator, appSettingsStore } from './appSettingsStore'

export function AppSettingsDialog() {
  const settings = useSelector(appSettingsStore, state => state.context.settings)
  const saving = useSelector(appSettingsStore, state => state.context.saving)
  const [warnBeforeRequestAfterSeconds, setWarnBeforeRequestAfterSeconds] = useState('10')
  const [responseBodyDisplayMode, setResponseBodyDisplayMode] = useState<(typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number]>('raw')
  const [databaseState, setDatabaseState] = useState<DatabaseConfigState | null>(null)
  const [databaseDrafts, setDatabaseDrafts] = useState<Record<string, { name: string; path: string }>>({})
  const [databaseLoading, setDatabaseLoading] = useState(false)
  const [databaseActionPending, setDatabaseActionPending] = useState(false)
  const [newDatabaseName, setNewDatabaseName] = useState('')
  const [newDatabasePath, setNewDatabasePath] = useState('')
  const [newDatabasePathTouched, setNewDatabasePathTouched] = useState(false)
  const [newDatabaseBasedOnName, setNewDatabaseBasedOnName] = useState('')

  useEffect(() => {
    if (settings) {
      setWarnBeforeRequestAfterSeconds(String(settings.warnBeforeRequestAfterSeconds))
      setResponseBodyDisplayMode(settings.responseBodyDisplayMode)
    }
  }, [settings])

  useEffect(() => {
    void loadDatabaseState()
  }, [])

  const handleSave = async () => {
    const value = Number(warnBeforeRequestAfterSeconds)
    const nextValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Number.NaN
    if (!Number.isFinite(nextValue)) {
      return
    }

    const success = await AppSettingsCoordinator.saveSettings({
      warnBeforeRequestAfterSeconds: nextValue,
      responseBodyDisplayMode,
    })

    if (success) {
      dialogActions.close()
    }
  }

  const syncDatabaseState = (nextState: DatabaseConfigState) => {
    setDatabaseState(nextState)
    setDatabaseDrafts(
      Object.fromEntries(nextState.items.map(item => [item.name, { name: item.name, path: item.path }]))
    )

    if (!newDatabasePathTouched) {
      setNewDatabasePath(buildSuggestedDatabasePath(nextState.defaultDirectoryPath, newDatabaseName))
    }
  }

  const loadDatabaseState = async () => {
    setDatabaseLoading(true)

    try {
      const nextState = await getWindowElectron().getDatabaseConfigState()
      syncDatabaseState(nextState)
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load databases',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setDatabaseLoading(false)
    }
  }

  const updateDatabaseDraft = (key: string, field: 'name' | 'path', value: string) => {
    setDatabaseDrafts(current => ({
      ...current,
      [key]: {
        name: field === 'name' ? value : current[key]?.name ?? '',
        path: field === 'path' ? value : current[key]?.path ?? '',
      },
    }))
  }

  const browseDatabasePath = async (target: 'new' | string) => {
    const suggestedPath =
      target === 'new'
        ? newDatabasePath || buildSuggestedDatabasePath(databaseState?.defaultDirectoryPath ?? '', newDatabaseName)
        : databaseDrafts[target]?.path

    const result = await getWindowElectron().pickDatabaseFile({ suggestedPath })
    if (!result.success) {
      if (errorResponseToMessage(result.error) !== 'File selection was cancelled') {
        toast.show(result)
      }
      return
    }

    if (target === 'new') {
      setNewDatabasePathTouched(true)
      setNewDatabasePath(result.data.filePath)
      return
    }

    updateDatabaseDraft(target, 'path', result.data.filePath)
  }

  const reloadWindowAfterDatabaseChange = () => {
    window.setTimeout(() => {
      window.location.reload()
    }, 150)
  }

  const runDatabaseAction = async (
    action: () => Promise<GenericResult<DatabaseConfigState>>,
    successTitle: string,
    successMessage: string,
    options?: { reloadOnSuccess?: boolean }
  ) => {
    setDatabaseActionPending(true)

    try {
      const result = await action()
      if (!result.success) {
        toast.show(result)
        return
      }

      syncDatabaseState(result.data)
      setNewDatabaseName('')
      setNewDatabaseBasedOnName('')
      setNewDatabasePathTouched(false)
      setNewDatabasePath(buildSuggestedDatabasePath(result.data.defaultDirectoryPath, ''))
      toast.show({ severity: 'success', title: successTitle, message: successMessage })
      if (options?.reloadOnSuccess ?? true) {
        reloadWindowAfterDatabaseChange()
      }
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Database update failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setDatabaseActionPending(false)
    }
  }

  const handleCreateDatabase = async () => {
    await runDatabaseAction(
      () =>
        getWindowElectron().upsertDatabaseConfig({
          name: newDatabaseName,
          path: newDatabasePath,
          basedOnName: newDatabaseBasedOnName || undefined,
        }),
      'Database added',
      'The database was added to the list.',
      { reloadOnSuccess: false }
    )
  }

  const handleSaveDatabase = async (databaseName: string) => {
    const draft = databaseDrafts[databaseName]
    if (!draft) {
      return
    }

    const shouldReload = databaseState?.activeName === databaseName

    await runDatabaseAction(
      () =>
        getWindowElectron().upsertDatabaseConfig({
          previousName: databaseName,
          name: draft.name,
          path: draft.path,
        }),
      'Database updated',
      shouldReload ? 'Database settings changed. Reloading the window.' : 'The database settings were updated.',
      { reloadOnSuccess: shouldReload }
    )
  }

  const handleDeleteDatabase = (databaseName: string) => {
    confirmation.trigger.confirm({
      title: 'Delete database?',
      message: `"${databaseName}" will be removed from the database list.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        const shouldReload = databaseState?.activeName === databaseName

        await runDatabaseAction(
          () => getWindowElectron().deleteDatabaseConfig({ name: databaseName }),
          'Database deleted',
          shouldReload ? 'Database list changed. Reloading the window.' : 'The database was removed from the list.',
          { reloadOnSuccess: shouldReload }
        )
      },
    })
  }

  const handleActivateDatabase = async (databaseName: string) => {
    if (databaseState?.activeName === databaseName) {
      return
    }

    await runDatabaseAction(
      () => getWindowElectron().setActiveDatabaseConfig({ name: databaseName }),
      'Database switched',
      'Active database changed. Reloading the window.'
    )
  }

  const isCreateDisabled = databaseActionPending || !newDatabaseName.trim() || !newDatabasePath.trim()

  const handleNewDatabaseNameChange = (value: string) => {
    setNewDatabaseName(value)

    if (!newDatabasePathTouched) {
      setNewDatabasePath(buildSuggestedDatabasePath(databaseState?.defaultDirectoryPath ?? '', value))
    }
  }

  const handleNewDatabasePathChange = (value: string) => {
    setNewDatabasePathTouched(true)
    setNewDatabasePath(value)
  }

  return (
    <Dialog
      title="Settings"
      onClose={() => dialogActions.close()}
      className="w-[90vw] max-w-[1400px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 p-4">
          <div className="text-sm font-medium text-base-content">Warn before request</div>
          <p className="mt-1 text-sm text-base-content/60">
            When an active environment has request warnings enabled, show a confirmation dialog if the last request is older than this threshold.
          </p>

          <label className="mt-4 block max-w-[220px]">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Seconds</div>
            <input
              type="number"
              min={0}
              step={1}
              className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
              value={warnBeforeRequestAfterSeconds}
              onChange={event => setWarnBeforeRequestAfterSeconds(event.target.value)}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 p-4">
          <div className="text-sm font-medium text-base-content">Response body display</div>
          <p className="mt-1 text-sm text-base-content/60">
            Choose whether the Raw response view should default to the original payload or a formatted preview when formatting is available.
          </p>

          <div className="mt-4 inline-flex overflow-hidden rounded-xl border border-base-content/10 bg-base-100/80">
            {APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.map(mode => (
              <button
                key={mode}
                type="button"
                className={[
                  'px-4 py-2 text-sm font-medium capitalize transition',
                  mode === responseBodyDisplayMode
                    ? 'bg-base-200 text-base-content'
                    : 'border-l border-base-content/10 text-base-content/60 first:border-l-0 hover:text-base-content',
                ].join(' ')}
                onClick={() => setResponseBodyDisplayMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 p-4">
          <div className="text-sm font-medium text-base-content">Databases</div>
          <p className="mt-1 text-sm text-base-content/60">
            Choose the active database, update saved database paths, or add another SQLite file. The window reloads after each
            successful database change.
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-base-content/10 bg-base-100">
            <table className="table table-zebra text-sm">
              <thead>
                <tr>
                  <th className="w-24">Active</th>
                  <th>Name</th>
                  <th>Path</th>
                  <th className="w-32">Size</th>
                  <th className="w-48">Actions</th>
                </tr>
              </thead>
              <tbody>
                {databaseLoading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-base-content/50">
                      Loading databases...
                    </td>
                  </tr>
                ) : databaseState?.items.length ? (
                  databaseState.items.map(item => {
                    const draft = databaseDrafts[item.name] ?? { name: item.name, path: item.path }
                    const isActive = databaseState.activeName === item.name
                    const hasChanges = draft.name !== item.name || draft.path !== item.path

                    return (
                      <tr key={item.name}>
                        <td>
                          <button
                            type="button"
                            className={`btn btn-xs ${isActive ? 'btn-success' : 'btn-soft'}`}
                            onClick={() => void handleActivateDatabase(item.name)}
                            disabled={databaseActionPending || isActive}
                          >
                            {isActive ? 'Active' : 'Use'}
                          </button>
                        </td>
                        <td>
                          {item.isDefault ? (
                            <span className="font-medium">default</span>
                          ) : (
                            <input
                              type="text"
                              className="input input-sm w-full border-base-content/10 bg-base-100"
                              value={draft.name}
                              onChange={event => updateDatabaseDraft(item.name, 'name', event.target.value)}
                              disabled={databaseActionPending}
                            />
                          )}
                        </td>
                        <td>
                          {item.isDefault ? (
                            <div className="break-all text-base-content/70">{item.path}</div>
                          ) : (
                            <div className="flex gap-2">
                              <input
                                type="text"
                                className="input input-sm min-w-[280px] flex-1 border-base-content/10 bg-base-100"
                                value={draft.path}
                                onChange={event => updateDatabaseDraft(item.name, 'path', event.target.value)}
                                disabled={databaseActionPending}
                              />
                              <button
                                type="button"
                                className="btn btn-sm btn-soft"
                                onClick={() => void browseDatabasePath(item.name)}
                                disabled={databaseActionPending}
                              >
                                Browse
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="text-base-content/60">{formatFileSize(item.sizeBytes)}</td>
                        <td>
                          <div className="flex gap-2">
                            {item.isDefault ? (
                              <span className="text-xs text-base-content/45">Default cannot be deleted.</span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-soft btn-primary"
                                  onClick={() => void handleSaveDatabase(item.name)}
                                  disabled={databaseActionPending || !hasChanges || !draft.name.trim() || !draft.path.trim()}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-soft btn-error"
                                  onClick={() => handleDeleteDatabase(item.name)}
                                  disabled={databaseActionPending}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-base-content/50">
                      No databases available.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 rounded-xl border border-dashed border-base-content/15 bg-base-100/70 p-4 md:grid-cols-[minmax(0,180px)_minmax(0,220px)_minmax(0,1fr)_auto_auto] md:items-end">
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Name</div>
              <input
                type="text"
                className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
                value={newDatabaseName}
                onChange={event => handleNewDatabaseNameChange(event.target.value)}
                disabled={databaseActionPending}
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Based on</div>
              <select
                className="select h-11 w-full rounded-xl border-base-content/10 bg-base-100"
                value={newDatabaseBasedOnName}
                onChange={event => setNewDatabaseBasedOnName(event.target.value)}
                disabled={databaseActionPending}
              >
                <option value="">Empty database</option>
                {databaseState?.items.map(item => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Path</div>
              <input
                type="text"
                className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
                value={newDatabasePath}
                onChange={event => handleNewDatabasePathChange(event.target.value)}
                disabled={databaseActionPending}
              />
            </label>

            <button
              type="button"
              className="btn h-11 btn-soft"
              onClick={() => void browseDatabasePath('new')}
              disabled={databaseActionPending}
            >
              Browse
            </button>

            <button
              type="button"
              className="btn h-11 btn-primary"
              onClick={() => void handleCreateDatabase()}
              disabled={isCreateDisabled}
            >
              Add database
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

function buildSuggestedDatabasePath(defaultDirectoryPath: string, name: string) {
  if (!defaultDirectoryPath) {
    return ''
  }

  const trimmedName = name.trim() || '{{name}}'
  const separator = defaultDirectoryPath.includes('\\') ? '\\' : '/'
  return `${defaultDirectoryPath}${separator}${trimmedName}.sqlite`
}

function formatFileSize(sizeBytes: number | null) {
  if (sizeBytes === null) {
    return 'Missing'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = sizeBytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}
