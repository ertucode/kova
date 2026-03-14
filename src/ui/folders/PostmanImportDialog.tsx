import { useMemo, useState } from 'react'
import { AlertTriangleIcon, FileJsonIcon, LoaderCircleIcon } from 'lucide-react'
import type { AnalyzePostmanCollectionResponse, PostmanImportWarning } from '@common/PostmanImport'
import { errorResponseToMessage } from '@common/GenericError'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { toast } from '@/lib/components/toast'

export function PostmanImportDialog() {
  const [filePath, setFilePath] = useState('')
  const [analysis, setAnalysis] = useState<AnalyzePostmanCollectionResponse | null>(null)
  const [useCollectionName, setUseCollectionName] = useState(true)
  const [customRootName, setCustomRootName] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const rootFolderName = useMemo(() => {
    if (useCollectionName) {
      return analysis?.suggestedRootFolderName ?? ''
    }

    return customRootName.trim()
  }, [analysis?.suggestedRootFolderName, customRootName, useCollectionName])

  const visibleWarnings = useMemo(
    () => (analysis?.warnings ?? []).filter(warning => warning.code !== 'scripts-commented'),
    [analysis?.warnings]
  )

  const close = () => dialogActions.close()

  const pickFile = async () => {
    setErrorMessage(null)
    const picked = await getWindowElectron().pickPostmanCollectionFile()
    if (!picked.success) {
      if (errorResponseToMessage(picked.error) !== 'File selection was cancelled') {
        setErrorMessage(errorResponseToMessage(picked.error))
      }
      return
    }

    setIsAnalyzing(true)
    setFilePath(picked.data.filePath)
    const nextAnalysis = await getWindowElectron().analyzePostmanCollection({ filePath: picked.data.filePath })
    setIsAnalyzing(false)

    if (!nextAnalysis.success) {
      setAnalysis(null)
      setErrorMessage(errorResponseToMessage(nextAnalysis.error))
      return
    }

    setAnalysis(nextAnalysis.data)
    setUseCollectionName(true)
    setCustomRootName(nextAnalysis.data.suggestedRootFolderName)
  }

  const importCollection = async () => {
    if (!analysis || !rootFolderName) {
      return
    }

    setIsImporting(true)
    setErrorMessage(null)
    const result = await getWindowElectron().importPostmanCollection({
      filePath: analysis.filePath,
      rootFolderName,
    })
    setIsImporting(false)

    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    await FolderExplorerCoordinator.loadItems()
    FolderExplorerCoordinator.selectItem({ itemType: 'folder', id: result.data.rootFolderId })
    toast.show({
      severity: 'success',
      title: 'Postman collection imported',
      message: `${result.data.requestCount} requests and ${result.data.folderCount} folders imported into ${result.data.rootFolderName}.`,
    })
    close()
  }

  return (
    <Dialog
      title="Import Postman Collection"
      onClose={close}
      className="max-w-[760px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={isImporting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void importCollection()} disabled={!analysis || !rootFolderName || isImporting}>
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 h-full flex-col gap-4">
        <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-base-content">Source File</div>
              <div className="mt-1 text-sm text-base-content/55">
                Pick a Postman collection JSON file. We will analyze it first and show any unsupported features before import.
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm text-base-content/72">
                <FileJsonIcon className="size-4 shrink-0" />
                <span className="truncate">{filePath || 'No file selected'}</span>
              </div>
            </div>

            <button type="button" className="btn btn-sm btn-outline" onClick={() => void pickFile()} disabled={isAnalyzing || isImporting}>
              {isAnalyzing ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
              Choose File
            </button>
          </div>
        </div>

        {analysis ? (
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-h-0 rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-sm font-semibold text-base-content">Import Review</div>
                  <div className="mt-1 text-sm text-base-content/55">
                    Review unsupported Postman behavior before importing. You can cancel here without changing anything.
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatCard label="Collection" value={analysis.collectionName} />
                <StatCard label="Folders" value={String(analysis.folderCount)} />
                <StatCard label="Requests" value={String(analysis.requestCount)} />
              </div>

              <div className="mt-4 rounded-xl border border-info/25 bg-info/10 p-3 text-sm text-base-content shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-info)_16%,transparent)]">
                Scripts are imported as commented reference blocks so users can rewrite them safely for Kova.
              </div>

              <div className="mt-4 min-h-0 space-y-3 pr-1">
                {visibleWarnings.length === 0 ? (
                  <div className="rounded-xl border border-success/25 bg-success/8 p-3 text-sm text-success-content/90">
                    No unsupported Postman features were detected in this file.
                  </div>
                ) : (
                  visibleWarnings.map(warning => <WarningCard key={warning.code} warning={warning} />)
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
              <div className="text-sm font-semibold text-base-content">Root Folder</div>
              <div className="mt-1 text-sm text-base-content/55">
                Import creates one top-level folder so collection-level settings stay grouped.
              </div>

              <label className="mt-4 flex items-center gap-3 text-sm text-base-content">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm rounded-none"
                  checked={useCollectionName}
                  onChange={event => setUseCollectionName(event.target.checked)}
                />
                Use collection name
              </label>

              <input
                type="text"
                className="input mt-3 h-10 w-full rounded-xl border-base-content/10 bg-base-100/70"
                value={useCollectionName ? analysis.suggestedRootFolderName : customRootName}
                disabled={useCollectionName}
                placeholder="Custom folder name"
                onChange={event => setCustomRootName(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {errorMessage ? <div className="rounded-xl border border-error/25 bg-error/8 px-3 py-2 text-sm text-error">{errorMessage}</div> : null}
      </div>
    </Dialog>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3">
      <div className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-base-content/45">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-base-content">{value}</div>
    </div>
  )
}

function WarningCard({ warning }: { warning: PostmanImportWarning }) {
  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/55 p-3">
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className={`mt-0.5 size-4 shrink-0 ${warning.severity === 'warning' ? 'text-warning' : 'text-info'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-base-content">{warning.message}</div>
          <div className="mt-1 text-xs text-base-content/55">{warning.count} occurrence{warning.count === 1 ? '' : 's'}</div>
          {warning.examples.length > 0 ? (
            <div className="mt-2 rounded-lg border border-base-content/10 bg-base-100/55 px-2 py-2 text-xs text-base-content/68">
              {warning.examples.map(example => (
                <div key={example} className="truncate">{example}</div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
