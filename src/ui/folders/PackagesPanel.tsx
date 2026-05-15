import { useMemo, useState } from 'react'
import { CheckIcon, DownloadIcon, PackageIcon, PencilIcon, RefreshCcwIcon, Trash2Icon, WandSparklesIcon, XIcon } from 'lucide-react'
import { buildScriptPackageCacheKey } from '@common/ScriptPackages'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { notifyScriptPackagesChanged, useScriptPackages } from './useScriptPackages'

type PendingState = Record<string, boolean>

export function PackagesPanel() {
  const { items, loading, reload } = useScriptPackages()
  const [packageName, setPackageName] = useState('')
  const [packageVersion, setPackageVersion] = useState('')
  const [typesPackageName, setTypesPackageName] = useState('')
  const [typesPackageVersion, setTypesPackageVersion] = useState('')
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null)
  const [editingTypesPackageName, setEditingTypesPackageName] = useState('')
  const [editingTypesPackageVersion, setEditingTypesPackageVersion] = useState('')
  const [pendingActions, setPendingActions] = useState<PendingState>({})

  const sortedItems = useMemo(
    () => items.slice().sort((left, right) => left.packageName.localeCompare(right.packageName) || left.packageVersion.localeCompare(right.packageVersion)),
    [items]
  )

  async function runPendingAction(key: string, action: () => Promise<void>) {
    setPendingActions(current => ({ ...current, [key]: true }))
    try {
      await action()
    } finally {
      setPendingActions(current => ({ ...current, [key]: false }))
    }
  }

  async function handleSuggestVersion() {
    const trimmedPackageName = packageName.trim()
    if (!trimmedPackageName) {
      toast.show({ severity: 'error', message: 'Enter a package name first.' })
      return
    }

    await runPendingAction('suggest-package-version', async () => {
      const result = await getWindowElectron().suggestScriptPackageVersion({ packageName: trimmedPackageName })
      if (!result.success) {
        toast.show(result)
        return
      }

      setPackageVersion(result.data.packageVersion)
      toast.show({ severity: 'success', message: `Suggested ${result.data.packageName}@${result.data.packageVersion}.` })
    })
  }

  async function handleSuggestTypes() {
    await suggestTypesPackage({
      packageName: packageName,
      packageVersion: packageVersion,
      pendingKey: 'suggest-types-package',
      onBuiltIn: () => {
        setTypesPackageName('')
        setTypesPackageVersion('')
      },
      onSuggested: (nextPackageName, nextPackageVersion) => {
        setTypesPackageName(nextPackageName)
        setTypesPackageVersion(nextPackageVersion)
      },
    })
  }

  async function suggestTypesPackage(input: {
    packageName: string
    packageVersion: string
    pendingKey: string
    onBuiltIn: () => void
    onSuggested: (packageName: string, packageVersion: string) => void
  }) {
    const trimmedPackageName = input.packageName.trim()
    const trimmedPackageVersion = input.packageVersion.trim()
    if (!trimmedPackageName || !trimmedPackageVersion) {
      toast.show({ severity: 'error', message: 'Enter the main package name and version first.' })
      return
    }

    await runPendingAction(input.pendingKey, async () => {
      const result = await getWindowElectron().suggestTypesScriptPackage({
        packageName: trimmedPackageName,
        packageVersion: trimmedPackageVersion,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      if (result.data.status === 'built-in') {
        input.onBuiltIn()
        toast.show({ severity: 'success', message: 'This package already includes its own TypeScript types.' })
        return
      }

      if (result.data.status === 'none') {
        toast.show({ severity: 'warning', message: 'No types package suggestion was found.' })
        return
      }

      input.onSuggested(result.data.packageName ?? '', result.data.packageVersion ?? '')
      toast.show({ severity: 'success', message: `Suggested ${result.data.packageName}@${result.data.packageVersion}.` })
    })
  }

  function startEditingTypes(item: { id: string; typesPackageName: string | null; typesPackageVersion: string | null }) {
    setEditingPackageId(item.id)
    setEditingTypesPackageName(item.typesPackageName ?? '')
    setEditingTypesPackageVersion(item.typesPackageVersion ?? '')
  }

  function stopEditingTypes() {
    setEditingPackageId(null)
    setEditingTypesPackageName('')
    setEditingTypesPackageVersion('')
  }

  async function handleSuggestRowTypes(item: { id: string; packageName: string; packageVersion: string }) {
    await suggestTypesPackage({
      packageName: item.packageName,
      packageVersion: item.packageVersion,
      pendingKey: `suggest-types-package:${item.id}`,
      onBuiltIn: () => {
        setEditingTypesPackageName('')
        setEditingTypesPackageVersion('')
      },
      onSuggested: (nextPackageName, nextPackageVersion) => {
        setEditingTypesPackageName(nextPackageName)
        setEditingTypesPackageVersion(nextPackageVersion)
      },
    })
  }

  async function handleUpdateTypes(item: {
    id: string
    packageName: string
    packageVersion: string
    typesPackageName: string | null
    typesPackageVersion: string | null
  }) {
    await runPendingAction(`update-types:${item.id}`, async () => {
      const nextTypesPackageName = editingTypesPackageName.trim() || null
      const nextTypesPackageVersion = editingTypesPackageVersion.trim() || null
      const previousCacheKey = buildScriptPackageCacheKey(item)

      const result = await getWindowElectron().updateScriptPackage({
        id: item.id,
        typesPackageName: nextTypesPackageName,
        typesPackageVersion: nextTypesPackageVersion,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      const nextCacheKey = buildScriptPackageCacheKey(result.data)
      stopEditingTypes()
      notifyScriptPackagesChanged()
      await reload()

      if (previousCacheKey !== nextCacheKey) {
        const purgeResult = await getWindowElectron().deleteDownloadedScriptPackage({
          packageName: item.packageName,
          packageVersion: item.packageVersion,
          typesPackageName: item.typesPackageName,
          typesPackageVersion: item.typesPackageVersion,
        })
        if (!purgeResult.success) {
          toast.show({ severity: 'warning', message: 'Updated types, but failed to remove the old package cache.' })
        }
      }

      const downloadResult = await getWindowElectron().downloadScriptPackage({
        packageName: result.data.packageName,
        packageVersion: result.data.packageVersion,
        typesPackageName: result.data.typesPackageName,
        typesPackageVersion: result.data.typesPackageVersion,
      })

      notifyScriptPackagesChanged()
      await reload()

      if (!downloadResult.success) {
        toast.show(downloadResult)
      }
    })
  }

  async function handleCreate() {
    await runPendingAction('create-package', async () => {
      const trimmedPackageName = packageName.trim()
      const trimmedPackageVersion = packageVersion.trim()
      const trimmedTypesPackageName = typesPackageName.trim()
      const trimmedTypesPackageVersion = typesPackageVersion.trim()
      const result = await getWindowElectron().createScriptPackage({
        packageName: trimmedPackageName,
        packageVersion: trimmedPackageVersion,
        typesPackageName: trimmedTypesPackageName || null,
        typesPackageVersion: trimmedTypesPackageVersion || null,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      notifyScriptPackagesChanged()
      await reload()

      const downloadResult = await getWindowElectron().downloadScriptPackage({
        packageName: result.data.packageName,
        packageVersion: result.data.packageVersion,
        typesPackageName: result.data.typesPackageName,
        typesPackageVersion: result.data.typesPackageVersion,
      })

      setPackageName('')
      setPackageVersion('')
      setTypesPackageName('')
      setTypesPackageVersion('')
      notifyScriptPackagesChanged()
      await reload()

      if (!downloadResult.success) {
        toast.show(downloadResult)
        return
      }
    })
  }

  async function handleDownload(cacheKey: string) {
    const item = items.find(current => current.cacheKey === cacheKey)
    if (!item) {
      return
    }

    await runPendingAction(`download:${cacheKey}`, async () => {
      const result = await getWindowElectron().downloadScriptPackage({
        packageName: item.packageName,
        packageVersion: item.packageVersion,
        typesPackageName: item.typesPackageName,
        typesPackageVersion: item.typesPackageVersion,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      notifyScriptPackagesChanged()
      await reload()
    })
  }

  async function handleDelete(id: string) {
    await runPendingAction(`delete:${id}`, async () => {
      const result = await getWindowElectron().deleteScriptPackage({ id })
      if (!result.success) {
        toast.show(result)
        return
      }

      notifyScriptPackagesChanged()
      await reload()
    })
  }

  async function handleDeleteDownloaded(cacheKey: string) {
    const item = items.find(current => current.cacheKey === cacheKey)
    if (!item) {
      return
    }

    await runPendingAction(`purge:${cacheKey}`, async () => {
      const result = await getWindowElectron().deleteDownloadedScriptPackage({
        packageName: item.packageName,
        packageVersion: item.packageVersion,
        typesPackageName: item.typesPackageName,
        typesPackageVersion: item.typesPackageVersion,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      notifyScriptPackagesChanged()
      await reload()
    })
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
      <div className="border-b border-base-content/10 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-base-content">
          <PackageIcon className="size-4" />
          Workspace Packages
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.2fr)_180px_minmax(0,1fr)_180px_auto]">
          <input
            value={packageName}
            onChange={event => setPackageName(event.target.value)}
            placeholder="Package name"
            className="h-10 rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm outline-none transition focus:border-primary/35"
          />
          <div className="flex gap-2">
            <input
              value={packageVersion}
              onChange={event => setPackageVersion(event.target.value)}
              placeholder="Version"
              className="h-10 min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm outline-none transition focus:border-primary/35"
            />
            <button
              type="button"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-base-content/10 bg-base-100 text-base-content/60 transition hover:border-base-content/20 hover:text-base-content"
              onClick={() => void handleSuggestVersion()}
              title="Suggest package version"
              disabled={pendingActions['suggest-package-version']}
            >
              <WandSparklesIcon className="size-4" />
            </button>
          </div>
          <input
            value={typesPackageName}
            onChange={event => setTypesPackageName(event.target.value)}
            placeholder="Types package name (optional)"
            className="h-10 rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm outline-none transition focus:border-primary/35"
          />
          <div className="flex gap-2">
            <input
              value={typesPackageVersion}
              onChange={event => setTypesPackageVersion(event.target.value)}
              placeholder="Types version"
              className="h-10 min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm outline-none transition focus:border-primary/35"
            />
            <button
              type="button"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-base-content/10 bg-base-100 text-base-content/60 transition hover:border-base-content/20 hover:text-base-content"
              onClick={() => void handleSuggestTypes()}
              title="Suggest types package"
              disabled={pendingActions['suggest-types-package']}
            >
              <WandSparklesIcon className="size-4" />
            </button>
          </div>
          <button
            type="button"
            className="h-10 rounded-xl bg-primary px-4 text-sm font-medium text-primary-content transition hover:opacity-90 disabled:cursor-default disabled:opacity-55"
            onClick={() => void handleCreate()}
            disabled={pendingActions['create-package']}
          >
            Add Package
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {loading ? <div className="text-sm text-base-content/45">Loading packages...</div> : null}
        {!loading && sortedItems.length === 0 ? <div className="text-sm text-base-content/45">No packages added yet.</div> : null}

        {sortedItems.length > 0 ? (
          <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-base-content/10 text-sm">
            <thead className="sticky top-0 bg-base-100">
              <tr className="text-left text-xs uppercase tracking-[0.08em] text-base-content/45">
                <th className="border-b border-base-content/10 px-4 py-3">Package</th>
                <th className="border-b border-base-content/10 px-4 py-3">Version</th>
                <th className="border-b border-base-content/10 px-4 py-3">Types</th>
                <th className="border-b border-base-content/10 px-4 py-3">Status</th>
                <th className="border-b border-base-content/10 px-4 py-3">Download</th>
                <th className="border-b border-base-content/10 px-4 py-3">Delete</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map(item => (
                <tr key={item.id} className="align-top text-base-content">
                  <td className="border-b border-base-content/10 px-4 py-3">
                    <div className="font-medium">{item.packageName}</div>
                  </td>
                  <td className="border-b border-base-content/10 px-4 py-3 font-mono text-xs">{item.packageVersion}</td>
                  <td className="border-b border-base-content/10 px-4 py-3">
                    {editingPackageId === item.id ? (
                      <div className="flex min-w-[18rem] flex-col gap-2">
                        <input
                          value={editingTypesPackageName}
                          onChange={event => setEditingTypesPackageName(event.target.value)}
                          placeholder="Types package name"
                          className="h-9 rounded-xl border border-base-content/10 bg-base-100 px-3 text-xs outline-none transition focus:border-primary/35"
                        />
                        <div className="flex gap-2">
                          <input
                            value={editingTypesPackageVersion}
                            onChange={event => setEditingTypesPackageVersion(event.target.value)}
                            placeholder="Types version"
                            className="h-9 min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 text-xs outline-none transition focus:border-primary/35"
                          />
                          <button
                            type="button"
                            className="grid size-9 shrink-0 place-items-center rounded-xl border border-base-content/10 bg-base-100 text-base-content/60 transition hover:border-base-content/20 hover:text-base-content"
                            onClick={() => void handleSuggestRowTypes(item)}
                            title="Suggest types package"
                            disabled={pendingActions[`suggest-types-package:${item.id}`] || pendingActions[`update-types:${item.id}`]}
                          >
                            <WandSparklesIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="grid size-9 shrink-0 place-items-center rounded-xl border border-success/20 bg-success/8 text-success transition hover:bg-success/14"
                            onClick={() => void handleUpdateTypes(item)}
                            title="Save types package"
                            disabled={pendingActions[`update-types:${item.id}`]}
                          >
                            <CheckIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="grid size-9 shrink-0 place-items-center rounded-xl border border-base-content/10 bg-base-100 text-base-content/60 transition hover:border-base-content/20 hover:text-base-content"
                            onClick={stopEditingTypes}
                            title="Cancel"
                            disabled={pendingActions[`update-types:${item.id}`]}
                          >
                            <XIcon className="size-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="text-xs text-base-content/60">
                          {item.typesPackageName && item.typesPackageVersion
                            ? `${item.typesPackageName}@${item.typesPackageVersion}`
                            : 'No extra types package'}
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-8 w-fit items-center gap-2 rounded-lg border border-base-content/10 bg-base-100 px-3 text-xs font-medium transition hover:border-base-content/20 hover:bg-base-200"
                          onClick={() => startEditingTypes(item)}
                          disabled={pendingActions[`update-types:${item.id}`]}
                        >
                          <PencilIcon className="size-3.5" />
                          {item.typesPackageName && item.typesPackageVersion ? 'Change Types' : 'Add Types'}
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="border-b border-base-content/10 px-4 py-3">
                    <div>{item.downloadStatus}</div>
                    {item.errorMessage ? <div className="mt-1 text-xs text-error">{item.errorMessage}</div> : null}
                  </td>
                  <td className="border-b border-base-content/10 px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-base-content/10 bg-base-100 px-3 text-xs font-medium transition hover:border-base-content/20 hover:bg-base-200"
                        onClick={() => void handleDownload(item.cacheKey)}
                        disabled={pendingActions[`download:${item.cacheKey}`] || item.downloadStatus === 'downloading'}
                      >
                        <DownloadIcon className="size-3.5" />
                        Download
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-base-content/10 bg-base-100 px-3 text-xs font-medium transition hover:border-base-content/20 hover:bg-base-200"
                        onClick={() => void handleDeleteDownloaded(item.cacheKey)}
                        disabled={pendingActions[`purge:${item.cacheKey}`] || item.downloadStatus === 'not-downloaded'}
                      >
                        <RefreshCcwIcon className="size-3.5" />
                        Purge Cache
                      </button>
                    </div>
                  </td>
                  <td className="border-b border-base-content/10 px-4 py-3">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-error/20 bg-error/6 px-3 text-xs font-medium text-error transition hover:bg-error/12"
                      onClick={() => void handleDelete(item.id)}
                      disabled={pendingActions[`delete:${item.id}`]}
                    >
                      <Trash2Icon className="size-3.5" />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  )
}
