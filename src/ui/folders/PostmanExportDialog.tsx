import { useEffect, useMemo, useState } from 'react'
import { AlertTriangleIcon, FileJsonIcon, LoaderCircleIcon } from 'lucide-react'
import type { AnalyzePostmanCollectionExportResponse, PostmanExportWarning } from '@common/PostmanExport'
import { errorResponseToMessage } from '@common/GenericError'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

export function PostmanExportDialog({ scope, folderId, requestId }: { scope: 'workspace' | 'folder' | 'request'; folderId?: string; requestId?: string }) {
  const [analysis, setAnalysis] = useState<AnalyzePostmanCollectionExportResponse | null>(null)
  const [collectionName, setCollectionName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(true)
  const [isPickingFile, setIsPickingFile] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    const run = async () => {
      setIsAnalyzing(true)
      const result = await getWindowElectron().analyzePostmanCollectionExport(
        scope === 'folder' && folderId
          ? { scope, folderId }
          : scope === 'request' && requestId
            ? { scope, requestId }
            : { scope: 'workspace' }
      )
      if (!isMounted) {
        return
      }

      setIsAnalyzing(false)
      if (!result.success) {
        setErrorMessage(errorResponseToMessage(result.error))
        return
      }

      setAnalysis(result.data)
      setCollectionName(result.data.suggestedCollectionName)
    }

    void run()
    return () => {
      isMounted = false
    }
  }, [folderId, requestId, scope])

  const suggestedFileName = useMemo(() => toJsonFileName(collectionName || analysis?.suggestedCollectionName || 'kova-collection'), [analysis?.suggestedCollectionName, collectionName])

  const pickFile = async () => {
    setIsPickingFile(true)
    setErrorMessage(null)
    const result = await getWindowElectron().pickPostmanCollectionExportFile({ suggestedFileName })
    setIsPickingFile(false)

    if (!result.success) {
      if (errorResponseToMessage(result.error) !== 'File selection was cancelled') {
        setErrorMessage(errorResponseToMessage(result.error))
      }
      return
    }

    setFilePath(result.data.filePath)
  }

  const exportCollection = async () => {
    if (!filePath || !collectionName.trim()) {
      return
    }

    setIsExporting(true)
    setErrorMessage(null)
    const result = await getWindowElectron().exportPostmanCollection({
      ...(scope === 'folder' && folderId
        ? { scope, folderId }
        : scope === 'request' && requestId
          ? { scope, requestId }
          : { scope: 'workspace' as const }),
      filePath,
      collectionName: collectionName.trim(),
    })
    setIsExporting(false)

    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    toast.show({
      severity: 'success',
      title: scope === 'folder' ? 'Postman folder exported' : scope === 'request' ? 'Postman request exported' : 'Postman collection exported',
      message: `${result.data.requestCount} requests exported to ${result.data.filePath}.`,
      actionLabel: 'Open file location',
      onAction: () => {
        void getWindowElectron().openFileLocation(result.data.filePath)
      },
    })
    dialogActions.close()
  }

  return (
    <Dialog
      title={scope === 'folder' ? 'Export Postman Folder' : scope === 'request' ? 'Export Postman Request' : 'Export Postman Collection'}
      onClose={() => dialogActions.close()}
      className="max-w-[760px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isExporting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void exportCollection()} disabled={!analysis || !filePath || !collectionName.trim() || isExporting}>
            {isExporting ? 'Exporting...' : 'Export'}
          </button>
        </>
      }
    >
      <div className="flex min-h-0 h-full flex-col gap-4">
        {isAnalyzing ? (
          <div className="flex items-center gap-3 rounded-2xl border border-base-content/10 bg-base-100/65 p-4 text-sm text-base-content/70">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {scope === 'folder' ? 'Analyzing selected folder...' : scope === 'request' ? 'Analyzing selected request...' : 'Analyzing current requests and folders...'}
          </div>
        ) : null}

        {analysis ? (
          <>
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
                <div className="text-sm font-semibold text-base-content">Export Review</div>
                <div className="mt-1 text-sm text-base-content/55">
                  Standard Postman fields export normally. Any Kova-only fields listed here are kept in metadata so Kova can restore them later.
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <StatCard label="Folders" value={String(analysis.folderCount)} />
                  <StatCard label="Requests" value={String(analysis.requestCount)} />
                  <StatCard label="Examples" value={String(analysis.exampleCount)} />
                </div>

                <div className="mt-4 space-y-3">
                  {analysis.warnings.length > 0 ? (
                    analysis.warnings.map(warning => <WarningCard key={warning.code} warning={warning} />)
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
                <div className="text-sm font-semibold text-base-content">Export File</div>
                <div className="mt-1 text-sm text-base-content/55">
                  Choose the Postman collection name and where to save the JSON file.
                </div>

                <label className="mt-4 block text-xs font-medium uppercase tracking-[0.08em] text-base-content/45">Collection Name</label>
                <input
                  type="text"
                  className="input mt-2 h-10 w-full rounded-xl border-base-content/10 bg-base-100/70"
                  value={collectionName}
                  onChange={event => setCollectionName(event.target.value)}
                />

                <div className="mt-4 text-xs font-medium uppercase tracking-[0.08em] text-base-content/45">Destination</div>
                <div className="mt-2 rounded-xl border border-base-content/10 bg-base-100/60 p-3 text-sm text-base-content/72">
                  <div className="flex items-center gap-2">
                    <FileJsonIcon className="size-4 shrink-0" />
                    <span className="truncate">{filePath || 'No file selected'}</span>
                  </div>
                </div>

                <button type="button" className="btn btn-outline btn-sm mt-3" onClick={() => void pickFile()} disabled={isPickingFile || isExporting}>
                  {isPickingFile ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
                  Choose File
                </button>
              </div>
            </div>
          </>
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

function WarningCard({ warning }: { warning: PostmanExportWarning }) {
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

function toJsonFileName(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${normalized || 'kova-collection'}.json`
}
