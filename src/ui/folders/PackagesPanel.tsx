import { useMemo, useState } from 'react'
import { DownloadIcon, PackageIcon, RefreshCcwIcon, Trash2Icon, WandSparklesIcon } from 'lucide-react'
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
    const trimmedPackageName = packageName.trim()
    const trimmedPackageVersion = packageVersion.trim()
    if (!trimmedPackageName || !trimmedPackageVersion) {
      toast.show({ severity: 'error', message: 'Enter the main package name and version first.' })
      return
    }

    await runPendingAction('suggest-types-package', async () => {
      const result = await getWindowElectron().suggestTypesScriptPackage({
        packageName: trimmedPackageName,
        packageVersion: trimmedPackageVersion,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      if (result.data.status === 'built-in') {
        setTypesPackageName('')
        setTypesPackageVersion('')
        toast.show({ severity: 'success', message: 'This package already includes its own TypeScript types.' })
        return
      }

      if (result.data.status === 'none') {
        toast.show({ severity: 'warning', message: 'No types package suggestion was found.' })
        return
      }

      setTypesPackageName(result.data.packageName ?? '')
      setTypesPackageVersion(result.data.packageVersion ?? '')
      toast.show({ severity: 'success', message: `Suggested ${result.data.packageName}@${result.data.packageVersion}.` })
    })
  }

  async function handleCreate() {
    await runPendingAction('create-package', async () => {
      const result = await getWindowElectron().createScriptPackage({
        packageName,
        packageVersion,
        typesPackageName: typesPackageName.trim() || null,
        typesPackageVersion: typesPackageVersion.trim() || null,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      setPackageName('')
      setPackageVersion('')
      setTypesPackageName('')
      setTypesPackageVersion('')
      notifyScriptPackagesChanged()
      await reload()
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
                    {item.typesPackageName && item.typesPackageVersion ? (
                      <div className="mt-1 text-xs text-base-content/45">
                        Types: {item.typesPackageName}@{item.typesPackageVersion}
                      </div>
                    ) : null}
                  </td>
                  <td className="border-b border-base-content/10 px-4 py-3 font-mono text-xs">{item.packageVersion}</td>
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
