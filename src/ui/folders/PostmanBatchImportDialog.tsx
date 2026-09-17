import { useEffect, useState } from 'react'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { toast } from '@/lib/components/toast'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { EnvironmentCoordinator } from './environmentCoordinator'

type ImportEntry = {
  filePath: string
  name: string
  summary: string
  warnings: string[]
  selected: boolean
  ready: boolean
  imported: boolean
  error?: string
}

export function PostmanBatchImportDialog({ kind, filePaths }: { kind: 'collection' | 'environment'; filePaths: string[] }) {
  const [entries, setEntries] = useState<ImportEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const analyze = async () => {
      const results = await Promise.all(filePaths.map(async (filePath): Promise<ImportEntry> => {
        const entry: ImportEntry = { filePath, name: '', summary: '', warnings: [], selected: true, ready: false, imported: false }
        try {
          const api = getWindowElectron()
          if (kind === 'collection') {
            const result = await api.analyzePostmanCollection({ filePath })
            if (!result.success) return { ...entry, selected: false, error: errorResponseToMessage(result.error) }
            return { ...entry, ready: true, name: result.data.suggestedRootFolderName,
              summary: `${result.data.requestCount} requests, ${result.data.folderCount} folders`,
              warnings: result.data.warnings.map(warning => warning.message) }
          }
          const result = await api.analyzePostmanEnvironment({ filePath })
          if (!result.success) return { ...entry, selected: false, error: errorResponseToMessage(result.error) }
          return { ...entry, ready: true, name: result.data.suggestedEnvironmentName,
            summary: `${result.data.variableCount} variables`, warnings: result.data.warnings.map(warning => warning.message) }
        } catch (error) {
          return { ...entry, selected: false, error: String(error) }
        }
      }))
      if (active) { setEntries(results); setLoading(false) }
    }
    void analyze()
    return () => { active = false }
  }, [filePaths, kind])

  const update = (filePath: string, change: Partial<ImportEntry>) => {
    setEntries(current => current.map(entry => entry.filePath === filePath ? { ...entry, ...change } : entry))
  }
  const selected = entries.filter(entry => entry.selected && entry.ready && !entry.imported)
  const importSelected = async () => {
    setBusy(true)
    setError('')
    let importedCount = 0
    try {
      for (const entry of selected) {
        try {
          const api = getWindowElectron()
          const result = kind === 'collection'
            ? await api.importPostmanCollection({ filePath: entry.filePath, target: 'new-folder', rootFolderName: entry.name.trim() })
            : await api.importPostmanEnvironment({ filePath: entry.filePath, environmentName: entry.name.trim() })
          if (!result.success) {
            update(entry.filePath, { error: errorResponseToMessage(result.error) })
            continue
          }
          importedCount++
          update(entry.filePath, { imported: true, selected: false, error: undefined })
        } catch (error) {
          update(entry.filePath, { error: String(error) })
        }
      }
      if (kind === 'collection') await FolderExplorerCoordinator.loadItems()
      else await EnvironmentCoordinator.loadEnvironments()
      if (importedCount) toast.show({ severity: 'success', title: 'Import complete', message: `${importedCount} ${kind}(s) imported.` })
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`Import Postman ${kind}s`} className="max-w-[760px]" dismissible={!busy}
      onClose={() => dialogActions.close()}
      footer={<>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => dialogActions.close()}>Close</button>
        <button type="button" className="btn btn-primary" disabled={loading || busy || !selected.length || selected.some(entry => !entry.name.trim())}
          onClick={() => void importSelected()}>{busy ? 'Importing...' : `Import selected (${selected.length})`}</button>
      </>}>
      <p className="mb-4 text-sm text-base-content/65">Review each file before importing. {kind === 'collection' ? 'Each collection becomes a separate root folder.' : 'Each file becomes a separate environment.'} Successfully imported files will not be imported again on retry.</p>
      {loading ? <p role="status">Analyzing files...</p> : <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={busy || !entries.some(entry => entry.ready && !entry.imported)}
            checked={entries.some(entry => entry.ready && !entry.imported) && entries.filter(entry => entry.ready && !entry.imported).every(entry => entry.selected)}
            onChange={event => setEntries(current => current.map(entry => entry.ready && !entry.imported ? { ...entry, selected: event.target.checked } : entry))} />Select all valid files
        </label>
        {entries.map(entry => <div key={entry.filePath} className="rounded-xl border border-base-content/15 p-3">
          <div className="flex items-center gap-3">
            <input type="checkbox" aria-label={`Import ${entry.name || entry.filePath}`} checked={entry.selected} disabled={busy || !entry.ready || entry.imported}
              onChange={event => update(entry.filePath, { selected: event.target.checked })} />
            <input className="input min-w-0 flex-1" aria-label={`Name for ${entry.filePath}`} value={entry.name} disabled={busy || !entry.ready || entry.imported}
              onChange={event => update(entry.filePath, { name: event.target.value })} />
            {entry.imported ? <span className="text-success">Imported</span> : null}
          </div>
          <p className="mt-2 break-all text-xs text-base-content/60">{entry.filePath}</p>
          <p className="mt-1 text-sm">{entry.summary}</p>
          {entry.warnings.map((warning, index) => <p key={index} className="mt-2 text-sm text-warning">{warning}</p>)}
          {entry.error ? <p role="alert" className="mt-2 text-sm text-error">{entry.error}</p> : null}
        </div>)}
      </div>}
      {error ? <p role="alert" className="mt-3 text-error">{error}</p> : null}
    </Dialog>
  )
}
