import { useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { AlertTriangleIcon, FileJsonIcon, LoaderCircleIcon } from 'lucide-react'
import type { AnalyzeOpenApiSpecResponse, OpenApiImportWarning } from '@common/OpenApiImport'
import { errorResponseToMessage } from '@common/GenericError'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { toast } from '@/lib/components/toast'

type ImportTarget = 'new-folder' | 'existing-folder' | 'global'

export function OpenApiImportDialog() {
  const items = useSelector(folderExplorerTreeStore, state => state.context.items)
  const [filePath, setFilePath] = useState('')
  const [analysis, setAnalysis] = useState<AnalyzeOpenApiSpecResponse | null>(null)
  const [useSpecName, setUseSpecName] = useState(true)
  const [customRootName, setCustomRootName] = useState('')
  const [importTarget, setImportTarget] = useState<ImportTarget>('new-folder')
  const [targetFolderId, setTargetFolderId] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const rootFolderName = useMemo(() => {
    if (useSpecName) {
      return analysis?.suggestedRootFolderName ?? ''
    }

    return customRootName.trim()
  }, [analysis?.suggestedRootFolderName, customRootName, useSpecName])

  const folderOptions = useMemo(() => {
    const folderItems = items.filter(item => item.itemType === 'folder')
    const folderById = new Map(folderItems.map(folder => [folder.id, folder]))

    const buildPath = (folderId: string) => {
      const names: string[] = []
      let currentId: string | null = folderId

      while (currentId) {
        const currentFolder = folderById.get(currentId)
        if (!currentFolder) {
          break
        }

        names.unshift(currentFolder.name)
        currentId = currentFolder.parentFolderId
      }

      return names.join(' / ')
    }

    return folderItems
      .map(folder => ({ id: folder.id, label: buildPath(folder.id) || folder.name }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }, [items])

  const canImport = Boolean(
    analysis
    && (importTarget !== 'new-folder' || rootFolderName)
    && (importTarget !== 'existing-folder' || targetFolderId)
    && !isImporting
  )

  const close = () => dialogActions.close()

  const pickFile = async () => {
    setErrorMessage(null)
    const picked = await getWindowElectron().pickOpenApiSpecFile()
    if (!picked.success) {
      if (errorResponseToMessage(picked.error) !== 'File selection was cancelled') {
        setErrorMessage(errorResponseToMessage(picked.error))
      }
      return
    }

    setIsAnalyzing(true)
    setFilePath(picked.data.filePath)
    const nextAnalysis = await getWindowElectron().analyzeOpenApiSpec({ filePath: picked.data.filePath })
    setIsAnalyzing(false)

    if (!nextAnalysis.success) {
      setAnalysis(null)
      setErrorMessage(errorResponseToMessage(nextAnalysis.error))
      return
    }

    setAnalysis(nextAnalysis.data)
    setUseSpecName(true)
    setCustomRootName(nextAnalysis.data.suggestedRootFolderName)
    setImportTarget('new-folder')
    setTargetFolderId(folderOptions[0]?.id ?? '')
  }

  const importSpec = async () => {
    if (!analysis) {
      return
    }

    setIsImporting(true)
    setErrorMessage(null)
    const result = await getWindowElectron().importOpenApiSpec({
      filePath: analysis.filePath,
      target: importTarget,
      targetFolderId: importTarget === 'existing-folder' ? targetFolderId : undefined,
      rootFolderName: importTarget === 'new-folder' ? rootFolderName : undefined,
    })
    setIsImporting(false)

    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    await FolderExplorerCoordinator.loadItems()
    if (result.data.createdRootFolderId) {
      await FolderExplorerCoordinator.selectItem({ itemType: 'folder', id: result.data.createdRootFolderId })
    } else if (result.data.primaryImportedItem) {
      await FolderExplorerCoordinator.selectItem(result.data.primaryImportedItem)
    }

    const destinationLabel = result.data.createdRootFolderName
      ?? folderOptions.find(folder => folder.id === result.data.targetFolderId)?.label
      ?? (result.data.targetFolderId === null ? 'global scope' : 'selected folder')

    toast.show({
      severity: 'success',
      title: 'OpenAPI spec imported',
      message: `${result.data.requestCount} requests and ${result.data.folderCount} folders imported into ${destinationLabel}.`,
    })
    close()
  }

  return (
    <Dialog
      title="Import OpenAPI Spec"
      onClose={close}
      className="max-w-[760px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={close} disabled={isImporting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void importSpec()} disabled={!canImport}>
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
                Pick an OpenAPI v3 JSON or YAML file. We will analyze it first and show unsupported behavior before import.
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
              <div className="text-sm font-semibold text-base-content">Import Review</div>
              <div className="mt-1 text-sm text-base-content/55">
                Review unsupported OpenAPI behavior before importing. Only HTTP requests are imported.
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <StatCard label="Spec" value={analysis.specName} />
                <StatCard label="Folders" value={String(analysis.folderCount)} />
                <StatCard label="Requests" value={String(analysis.requestCount)} />
              </div>

              <div className="mt-4 space-y-3 pr-1">
                {analysis.warnings.length === 0 ? (
                  <div className="rounded-xl border border-success/25 bg-success/10 p-3 text-sm text-base-content">
                    No import warnings were detected in this file.
                  </div>
                ) : (
                  analysis.warnings.map(warning => <WarningCard key={warning.code} warning={warning} />)
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
              <div className="text-sm font-semibold text-base-content">Import Target</div>
              <div className="mt-1 text-sm text-base-content/55">
                Choose whether to create a new root folder, import into an existing folder, or place the spec directly in global scope.
              </div>

              <div className="mt-4 space-y-2">
                <label className="flex items-start gap-3 rounded-xl border border-base-content/10 bg-base-100/55 px-3 py-3 text-sm text-base-content">
                  <input
                    type="radio"
                    name="openapi-import-target"
                    className="checkbox checkbox-sm mt-0.5 rounded-none"
                    checked={importTarget === 'new-folder'}
                    onChange={() => setImportTarget('new-folder')}
                  />
                  <span>Create new root folder</span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-base-content/10 bg-base-100/55 px-3 py-3 text-sm text-base-content">
                  <input
                    type="radio"
                    name="openapi-import-target"
                    className="checkbox checkbox-sm mt-0.5 rounded-none"
                    checked={importTarget === 'existing-folder'}
                    onChange={() => setImportTarget('existing-folder')}
                  />
                  <span>Import into existing folder</span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-base-content/10 bg-base-100/55 px-3 py-3 text-sm text-base-content">
                  <input
                    type="radio"
                    name="openapi-import-target"
                    className="checkbox checkbox-sm mt-0.5 rounded-none"
                    checked={importTarget === 'global'}
                    onChange={() => setImportTarget('global')}
                  />
                  <span>Import to global scope</span>
                </label>
              </div>

              {importTarget === 'existing-folder' ? (
                <>
                  <label className="mt-4 block text-xs font-medium uppercase tracking-[0.08em] text-base-content/45">Destination Folder</label>
                  <select
                    className="select mt-2 min-h-10 w-full rounded-xl border-base-content/10 bg-base-100"
                    value={targetFolderId}
                    onChange={event => setTargetFolderId(event.target.value)}
                  >
                    <option value="" disabled>Select a folder</option>
                    {folderOptions.map(folder => (
                      <option key={folder.id} value={folder.id}>{folder.label}</option>
                    ))}
                  </select>
                </>
              ) : null}

              {importTarget === 'new-folder' ? (
                <>
                  <label className="mt-4 flex items-center gap-3 text-sm text-base-content">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm rounded-none"
                      checked={useSpecName}
                      onChange={event => setUseSpecName(event.target.checked)}
                    />
                    Use spec name
                  </label>

                  <input
                    type="text"
                    className="input mt-3 h-10 w-full rounded-xl border-base-content/10 bg-base-100/70"
                    value={useSpecName ? analysis.suggestedRootFolderName : customRootName}
                    disabled={useSpecName}
                    placeholder="Custom folder name"
                    onChange={event => setCustomRootName(event.target.value)}
                  />
                </>
              ) : null}
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

function WarningCard({ warning }: { warning: OpenApiImportWarning }) {
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
