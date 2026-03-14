import { useMemo, useState } from 'react'
import { AlertTriangleIcon, FileJsonIcon, LoaderCircleIcon } from 'lucide-react'
import type { AnalyzePostmanEnvironmentResponse, PostmanEnvironmentImportWarning } from '@common/PostmanEnvironmentImport'
import { errorResponseToMessage } from '@common/GenericError'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { toast } from '@/lib/components/toast'

export function PostmanEnvironmentImportDialog() {
  const [analysis, setAnalysis] = useState<AnalyzePostmanEnvironmentResponse | null>(null)
  const [filePath, setFilePath] = useState('')
  const [useSourceName, setUseSourceName] = useState(true)
  const [customName, setCustomName] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const environmentName = useMemo(() => (useSourceName ? analysis?.suggestedEnvironmentName ?? '' : customName.trim()), [analysis?.suggestedEnvironmentName, customName, useSourceName])

  const pickFile = async () => {
    setErrorMessage(null)
    const picked = await getWindowElectron().pickPostmanEnvironmentFile()
    if (!picked.success) {
      if (errorResponseToMessage(picked.error) !== 'File selection was cancelled') {
        setErrorMessage(errorResponseToMessage(picked.error))
      }
      return
    }

    setIsAnalyzing(true)
    setFilePath(picked.data.filePath)
    const analyzed = await getWindowElectron().analyzePostmanEnvironment({ filePath: picked.data.filePath })
    setIsAnalyzing(false)

    if (!analyzed.success) {
      setAnalysis(null)
      setErrorMessage(errorResponseToMessage(analyzed.error))
      return
    }

    setAnalysis(analyzed.data)
    setCustomName(analyzed.data.suggestedEnvironmentName)
    setUseSourceName(true)
  }

  const importEnvironment = async () => {
    if (!analysis || !environmentName) {
      return
    }

    setIsImporting(true)
    const result = await getWindowElectron().importPostmanEnvironment({ filePath: analysis.filePath, environmentName })
    setIsImporting(false)

    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    await EnvironmentCoordinator.loadEnvironments()
    EnvironmentCoordinator.selectEnvironment(result.data.environmentId)
    toast.show({ severity: 'success', title: 'Environment imported', message: `${result.data.environmentName} imported successfully.` })
    dialogActions.close()
  }

  return (
    <Dialog
      title="Import Postman Environment"
      onClose={() => dialogActions.close()}
      className="max-w-[760px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isImporting}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void importEnvironment()} disabled={!analysis || !environmentName || isImporting}>{isImporting ? 'Importing...' : 'Import'}</button>
        </>
      }
    >
      <div className="flex min-h-0 h-full flex-col gap-4">
        <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-base-content">Source File</div>
              <div className="mt-1 text-sm text-base-content/55">Import a Postman environment JSON file and review any duplicate-key overrides first.</div>
              <div className="mt-3 flex items-center gap-2 text-sm text-base-content/72"><FileJsonIcon className="size-4 shrink-0" /><span className="truncate">{filePath || 'No file selected'}</span></div>
            </div>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => void pickFile()} disabled={isAnalyzing || isImporting}>{isAnalyzing ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}Choose File</button>
          </div>
        </div>

        {analysis ? (
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
              <div className="text-sm font-semibold text-base-content">Import Review</div>
              <div className="mt-1 text-sm text-base-content/55">Duplicate keys are allowed. The last enabled value wins everywhere in Kova.</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <StatCard label="Environment" value={analysis.environmentName} />
                <StatCard label="Variables" value={String(analysis.variableCount)} />
              </div>
              <div className="mt-4 space-y-3">
                {analysis.warnings.length === 0 ? <div className="rounded-xl border border-success/25 bg-success/8 p-3 text-sm text-success-content/90">No import warnings detected.</div> : analysis.warnings.map(warning => <WarningCard key={warning.code} warning={warning} />)}
              </div>
            </div>
            <div className="rounded-2xl border border-base-content/10 bg-base-100/65 p-4">
              <div className="text-sm font-semibold text-base-content">Environment Name</div>
              <label className="mt-4 flex items-center gap-3 text-sm text-base-content">
                <input type="checkbox" className="checkbox checkbox-sm rounded-none" checked={useSourceName} onChange={event => setUseSourceName(event.target.checked)} />
                Use Postman environment name
              </label>
              <input type="text" className="input mt-3 h-10 w-full rounded-xl border-base-content/10 bg-base-100/70" value={useSourceName ? analysis.suggestedEnvironmentName : customName} disabled={useSourceName} onChange={event => setCustomName(event.target.value)} />
            </div>
          </div>
        ) : null}

        {errorMessage ? <div className="rounded-xl border border-error/25 bg-error/8 px-3 py-2 text-sm text-error">{errorMessage}</div> : null}
      </div>
    </Dialog>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3"><div className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-base-content/45">{label}</div><div className="mt-1 truncate text-sm font-semibold text-base-content">{value}</div></div>
}

function WarningCard({ warning }: { warning: PostmanEnvironmentImportWarning }) {
  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/55 p-3">
      <div className="flex items-start gap-3">
        <AlertTriangleIcon className={`mt-0.5 size-4 shrink-0 ${warning.severity === 'warning' ? 'text-warning' : 'text-info'}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-base-content">{warning.message}</div>
          <div className="mt-1 text-xs text-base-content/55">{warning.count} occurrence{warning.count === 1 ? '' : 's'}</div>
          {warning.examples.length > 0 ? <div className="mt-2 rounded-lg border border-base-content/10 bg-base-100/55 px-2 py-2 text-xs text-base-content/68">{warning.examples.map(example => <div key={example} className="truncate">{example}</div>)}</div> : null}
        </div>
      </div>
    </div>
  )
}
