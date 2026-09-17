import { useEffect, useState } from 'react'
import type { PostmanArchiveEntry } from '@common/PostmanArchive'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { toast } from '@/lib/components/toast'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { environmentEditorStore } from './environmentEditorStore'

type ExportEntry = { target: PostmanArchiveEntry; selected: boolean; warnings: string[]; summary: string; error?: string }

export function PostmanBatchExportDialog({ kind }: { kind: 'collection' | 'environment' }) {
  const [entries, setEntries] = useState<ExportEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    const analyze = async () => {
      const targets: PostmanArchiveEntry[] = kind === 'environment'
        ? environmentEditorStore.getSnapshot().context.items.filter(item => item.folderId == null)
          .map(item => ({ kind: 'environment', environmentId: item.id, name: item.name }))
        : folderExplorerTreeStore.getSnapshot().context.items.filter(item => item.itemType !== 'example').filter(item => item.parentFolderId == null)
          .filter(item => item.itemType === 'folder' || item.requestType === 'http')
          .map(item => item.itemType === 'folder'
            ? { kind: 'collection', scope: 'folder', folderId: item.id, name: item.name }
            : { kind: 'collection', scope: 'request', requestId: item.id, name: item.name })
      const results = await Promise.all(targets.map(async (target): Promise<ExportEntry> => {
        try {
          const api = getWindowElectron()
          const result = target.kind === 'environment'
            ? await api.analyzePostmanEnvironmentExport({ environmentId: target.environmentId })
            : await api.analyzePostmanCollectionExport(target)
          if (!result.success) return { target, selected: false, warnings: [], summary: '', error: errorResponseToMessage(result.error) }
          return { target, selected: true, warnings: result.data.warnings.map(warning => warning.message),
            summary: 'variableCount' in result.data ? `${result.data.variableCount} variables` : `${result.data.requestCount} requests, ${result.data.folderCount} folders` }
        } catch (error) {
          return { target, selected: false, warnings: [], summary: '', error: String(error) }
        }
      }))
      if (active) { setEntries(results); setLoading(false) }
    }
    void analyze()
    return () => { active = false }
  }, [kind])

  const selected = entries.filter(entry => entry.selected && !entry.error)
  const exportSelected = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await getWindowElectron().exportPostmanArchive({ entries: selected.map(entry => entry.target) })
      if (!result.success) {
        const message = errorResponseToMessage(result.error)
        if (message !== 'File selection was cancelled') setError(message)
        return
      }
      toast.show({ severity: 'success', title: 'Export complete', message: `${result.data.fileCount} JSON files exported to ${result.data.filePath}.`,
        actionLabel: 'Open file location', onAction: () => { void getWindowElectron().openFileLocation(result.data.filePath) } })
      dialogActions.close()
    } catch (error) {
      setError(String(error))
    } finally {
      setBusy(false)
    }
  }

  return <Dialog title={`Export multiple ${kind}s`} className="max-w-[760px]" dismissible={!busy} onClose={() => dialogActions.close()}
    footer={<>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => dialogActions.close()}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy || loading || !selected.length} onClick={() => void exportSelected()}>
        {busy ? 'Exporting...' : `Export ZIP (${selected.length})`}
      </button>
    </>}>
    <p className="mb-3 text-sm text-base-content/65">Export saved {kind}s as separate Postman JSON files in one ZIP. Extract the ZIP before importing. {kind === 'collection' ? 'Root folders include their descendants; loose HTTP requests are exported separately.' : ''}</p>
    <p className="mb-4 text-sm text-warning">Exports can contain tokens, credentials and environment values. Share them carefully.</p>
    {loading ? <p role="status">Analyzing exports...</p> : <div className="space-y-3">
      <input type="search" className="input w-full" placeholder="Search exports..." aria-label="Search exports" value={query} onChange={event => setQuery(event.target.value)} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={busy || !entries.some(entry => !entry.error)}
          checked={entries.some(entry => !entry.error) && entries.filter(entry => !entry.error).every(entry => entry.selected)}
          onChange={event => setEntries(current => current.map(entry => entry.error ? entry : { ...entry, selected: event.target.checked }))} />Select all (including hidden results)
      </label>
      {!entries.length ? <p>No {kind}s available to export.</p> : null}
      {entries.map((entry, index) => entry.target.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ?
        <div key={index} className="rounded-xl border border-base-content/15 p-3">
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={entry.selected} disabled={busy || Boolean(entry.error)}
              onChange={event => setEntries(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} />
            <span>{entry.target.name}</span><span className="ml-auto text-xs text-base-content/60">{entry.summary}</span>
          </label>
          {entry.warnings.map((warning, index) => <p key={index} className="mt-2 text-sm text-warning">{warning}</p>)}
          {entry.error ? <p role="alert" className="mt-2 text-error">{entry.error}</p> : null}
        </div> : null)}
    </div>}
    {error ? <p role="alert" className="mt-3 text-error">{error}</p> : null}
  </Dialog>
}
