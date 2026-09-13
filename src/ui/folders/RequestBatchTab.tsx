import { useEffect, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlayIcon,
  SearchIcon,
  SquareIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import type { PickRequestBatchFileResponse, RequestBatchRecord, RequestBatchRowRecord } from '@common/RequestBatches'
import type { RequestExecutionRecord } from '@common/Requests'
import { Typescript } from '@common/Typescript'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import {
  RequestDetailsResponsePanel,
  type RequestDetailsResponsePanelProps,
} from './RequestDetailsResponsePanel'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { buildSendRequestInput } from './requestSendInput'
import {
  REQUEST_BATCH_ROW_PAGE_SIZE,
  RequestBatchCoordinator,
  requestBatchStore,
  type RequestBatchPage,
} from './requestBatchStore'

type RequestBatchTabProps = {
  requestId: string
  draft: RequestDetailsDraft
  activeEnvironmentIds: string[]
  historyKeepLast: number
  responsePanelProps: Omit<RequestDetailsResponsePanelProps, 'isSending' | 'execution'>
}

const EMPTY_REQUEST_BATCHES: RequestBatchRecord[] = []

export function RequestBatchTab({
  requestId,
  draft,
  activeEnvironmentIds,
  historyKeepLast,
  responsePanelProps,
}: RequestBatchTabProps) {
  const batches = useSelector(
    requestBatchStore,
    state => state.context.batchesByRequestId[requestId] ?? EMPTY_REQUEST_BATCHES
  )
  const loading = useSelector(requestBatchStore, state => state.context.loadingByRequestId[requestId] ?? false)
  const selectedBatchId = useSelector(
    requestBatchStore,
    state => state.context.selectedBatchIdByRequestId[requestId] ?? null
  )
  const page = useSelector(requestBatchStore, state =>
    selectedBatchId ? (state.context.pageByBatchId[selectedBatchId] ?? null) : null
  )
  const [pickedFile, setPickedFile] = useState<PickRequestBatchFileResponse | null>(null)
  const [batchName, setBatchName] = useState('')
  const [sheetName, setSheetName] = useState('')
  const [pickingFile, setPickingFile] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    void RequestBatchCoordinator.loadBatches(requestId)
  }, [requestId])

  const pickFile = async () => {
    setPickingFile(true)
    try {
      const result = await getWindowElectron().pickRequestBatchFile()
      if (!result.success) {
        if (errorResponseToMessage(result.error) !== 'File selection was cancelled') {
          toast.show(result)
        }
        return
      }
      setPickedFile(result.data)
      setBatchName(result.data.sourceFileName)
      setSheetName(result.data.sheetNames[0] ?? '')
    } finally {
      setPickingFile(false)
    }
  }

  const importFile = async () => {
    if (!pickedFile || !batchName.trim()) return
    setImporting(true)
    try {
      await RequestBatchCoordinator.importBatch({
        filePath: pickedFile.filePath,
        sheetName: pickedFile.sourceType === 'xlsx' ? sheetName || undefined : undefined,
        requestId,
        requestName: draft.name,
        name: batchName.trim(),
      })
      setPickedFile(null)
      setBatchName('')
      setSheetName('')
    } catch {
      return
    } finally {
      setImporting(false)
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100/30">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-content/10 bg-base-200/25 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-base-content">Batch requests</div>
          <div className="text-xs text-base-content/45">
            Run this request once for each row in CSV, XLSX, or JSON data.
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-xl border border-base-content/15 bg-base-100 px-3 py-2 text-xs font-semibold text-base-content/70 transition hover:border-base-content/25 hover:text-base-content"
          onClick={() => void pickFile()}
          disabled={pickingFile || importing}
        >
          <UploadIcon className="size-3.5" /> {pickingFile ? 'Choosing...' : 'Upload batch'}
        </button>
      </div>

      {pickedFile ? (
        <div className="grid gap-3 border-b border-base-content/10 bg-base-200/45 p-4 md:grid-cols-[minmax(180px,1fr)_minmax(160px,0.7fr)_auto] md:items-end">
          <label className="grid gap-1 text-xs font-medium text-base-content/55">
            Batch name
            <input
              className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none focus:border-base-content/25"
              value={batchName}
              onChange={event => setBatchName(event.target.value)}
            />
          </label>
          {pickedFile.sourceType === 'xlsx' ? (
            <label className="grid gap-1 text-xs font-medium text-base-content/55">
              Sheet
              <select
                className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none"
                value={sheetName}
                onChange={event => setSheetName(event.target.value)}
              >
                {pickedFile.sheetNames.map(name => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="truncate pb-2 text-xs text-base-content/45">{pickedFile.sourceFileName}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-xl px-3 py-2 text-xs font-medium text-base-content/50 hover:bg-base-100/60"
              onClick={() => setPickedFile(null)}
              disabled={importing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-content disabled:opacity-45"
              onClick={() => void importFile()}
              disabled={importing || !batchName.trim() || (pickedFile.sourceType === 'xlsx' && !sheetName)}
            >
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-base-content/10 bg-base-200/20 p-3 md:border-r md:border-b-0">
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/40">
            Previous batches
          </div>
          {loading && batches.length === 0 ? (
            <div className="px-1 py-3 text-sm text-base-content/40">Loading...</div>
          ) : null}
          {!loading && batches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-content/10 p-3 text-sm text-base-content/40">
              No batches imported yet.
            </div>
          ) : null}
          <div className="grid gap-1.5">
            {batches.map(batch => (
              <button
                key={batch.id}
                type="button"
                className={[
                  'min-w-0 rounded-xl border px-3 py-2.5 text-left transition',
                  selectedBatchId === batch.id
                    ? 'border-base-content/20 bg-base-100 text-base-content'
                    : 'border-transparent text-base-content/60 hover:border-base-content/10 hover:bg-base-100/60',
                ].join(' ')}
                onClick={() => void RequestBatchCoordinator.selectBatch(requestId, batch.id)}
              >
                <div className="truncate text-sm font-medium">{batch.name}</div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-base-content/40">
                  <span>{formatDate(batch.createdAt)}</span>
                  <span className={getBatchStatusClassName(batch.status)}>{batch.status}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="min-h-0 min-w-0 overflow-hidden">
          {page ? (
            <BatchDetails
              key={page.batch.id}
              page={page}
              requestId={requestId}
              draft={draft}
              activeEnvironmentIds={activeEnvironmentIds}
              historyKeepLast={historyKeepLast}
              responsePanelProps={responsePanelProps}
              onCancel={() => RequestBatchCoordinator.cancelBatch(page.batch.id)}
              onDelete={() => {
                confirmation.trigger.confirm({
                  title: 'Delete batch?',
                  message: `"${page.batch.name}" and its saved request history will be deleted.`,
                  confirmText: 'Delete',
                  onConfirm: () => RequestBatchCoordinator.deleteBatch(requestId, page.batch.id),
                })
              }}
            />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-base-content/40">
              Upload a data file to create a batch.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function BatchDetails({
  page,
  requestId,
  draft,
  activeEnvironmentIds,
  historyKeepLast,
  responsePanelProps,
  onCancel,
  onDelete,
}: {
  page: RequestBatchPage
  requestId: string
  draft: RequestDetailsDraft
  activeEnvironmentIds: string[]
  historyKeepLast: number
  responsePanelProps: Omit<RequestDetailsResponsePanelProps, 'isSending' | 'execution'>
  onCancel: () => Promise<void>
  onDelete: () => void
}) {
  const batch = page.batch
  const [concurrencyValue, setConcurrencyValue] = useState(() => batch.concurrency?.toString() ?? '1')
  const [searchValue, setSearchValue] = useState(() => page.rowSearchQuery)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)
  const [historyByRowId, setHistoryByRowId] = useState<Record<string, RequestExecutionRecord>>({})
  const [historyErrorByRowId, setHistoryErrorByRowId] = useState<Record<string, string>>({})
  const [loadingRowId, setLoadingRowId] = useState<string | null>(null)
  const [runningRowId, setRunningRowId] = useState<string | null>(null)
  const isActive = batch.status === 'running'
  const canStart = !isActive
  const isFirstRun = batch.status === 'ready' && batch.summary.pendingCount === batch.summary.totalCount
  const pageNumber = Math.floor(page.rowOffset / REQUEST_BATCH_ROW_PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(page.totalRowCount / REQUEST_BATCH_ROW_PAGE_SIZE))

  useEffect(() => {
    if (searchValue === page.rowSearchQuery) return
    const timeout = window.setTimeout(() => {
      void RequestBatchCoordinator.loadPage(batch.id, searchValue, 0)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [batch.id, page.rowSearchQuery, searchValue])

  const startBatch = async () => {
    const concurrency = Number(concurrencyValue)
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
      toast.show({ severity: 'warning', message: 'Concurrency must be a positive integer.' })
      return
    }
    setStarting(true)
    try {
      await RequestBatchCoordinator.startBatch(
        batch.id,
        concurrency,
        buildSendRequestInput({ requestId, draft, activeEnvironmentIds, historyKeepLast })
      )
    } catch {
      return
    } finally {
      setStarting(false)
    }
  }

  const cancelBatch = async () => {
    setCancelling(true)
    try {
      await onCancel()
    } catch {
      setCancelling(false)
    }
  }

  const runRow = async (row: RequestBatchRowRecord) => {
    setRunningRowId(row.id)
    setExpandedRowId(null)
    setHistoryByRowId(current => omitKey(current, row.id))
    setHistoryErrorByRowId(current => omitKey(current, row.id))
    try {
      await RequestBatchCoordinator.runRow(
        batch.id,
        row.id,
        buildSendRequestInput({ requestId, draft, activeEnvironmentIds, historyKeepLast })
      )
    } catch {
      return
    } finally {
      setRunningRowId(null)
    }
  }

  const toggleRow = async (row: RequestBatchRowRecord) => {
    if (row.status !== 'completed') return
    if (expandedRowId === row.id) {
      setExpandedRowId(null)
      return
    }
    setExpandedRowId(row.id)
    if (!row.historyId || historyByRowId[row.id] || loadingRowId === row.id) return
    setLoadingRowId(row.id)
    const result = await getWindowElectron().getRequestHistoryEntry({ id: row.historyId })
    setLoadingRowId(current => (current === row.id ? null : current))
    if (result.success) {
      setHistoryByRowId(current => ({ ...current, [row.id]: result.data }))
      return
    }
    setHistoryErrorByRowId(current => ({ ...current, [row.id]: 'The saved history entry is unavailable.' }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-base-content/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-base-content">{batch.name}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${getBatchStatusClassName(batch.status)}`}
              >
                {batch.status}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-base-content/40">
              {batch.sourceFileName}
              {batch.sheetName ? ` / ${batch.sheetName}` : ''} · {batch.rowCount} rows
            </div>
          </div>
          <div className="flex items-end gap-2">
            {canStart ? (
              <label className="grid gap-1 text-[11px] font-medium text-base-content/50">
                Concurrency
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="w-24 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none"
                  value={concurrencyValue}
                  onChange={event => setConcurrencyValue(event.target.value)}
                />
              </label>
            ) : null}
            {canStart ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-success/25 bg-success/10 px-3 py-2 text-xs font-semibold text-success hover:bg-success/15 disabled:opacity-45"
                onClick={() => void startBatch()}
                disabled={starting}
              >
                <PlayIcon className="size-3.5" />{' '}
                {starting ? 'Starting...' : isFirstRun ? 'Start' : 'Run again'}
              </button>
            ) : null}
            {isActive ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-error/25 bg-error/10 px-3 py-2 text-xs font-semibold text-error hover:bg-error/15"
                onClick={() => void cancelBatch()}
                disabled={cancelling}
              >
                <SquareIcon className="size-3.5" /> {cancelling ? 'Cancelling...' : 'Cancel'}
              </button>
            ) : (
              <button
                type="button"
                className="rounded-xl border border-base-content/10 p-2 text-base-content/40 hover:border-error/20 hover:bg-error/10 hover:text-error"
                onClick={onDelete}
                aria-label="Delete batch"
                title="Delete batch"
              >
                <Trash2Icon className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <BatchMetric label="Total" value={batch.summary.totalCount} />
          <BatchMetric label="Pending" value={batch.summary.pendingCount} />
          <BatchMetric label="Running" value={batch.summary.runningCount} tone="text-info" />
          <BatchMetric label="Completed" value={batch.summary.completedCount} tone="text-success" />
          <BatchMetric label="Failed" value={batch.summary.failedCount} tone="text-error" />
          <BatchMetric label="Cancelled" value={batch.summary.cancelledCount} tone="text-warning" />
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-base-content/10 px-4 py-2.5">
        <SearchIcon className="size-3.5 text-base-content/35" />
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/30"
          value={searchValue}
          placeholder="Search every row or status..."
          onChange={event => setSearchValue(event.target.value)}
        />
        {page.loading ? <span className="text-[11px] text-base-content/35">Loading...</span> : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-base-200">
            <tr>
              <th className="w-10 border-b border-base-content/10 px-3 py-2.5 text-base-content/40">#</th>
              <th className="w-28 border-b border-base-content/10 px-3 py-2.5 text-base-content/40">Status</th>
              {batch.columns.map(column => (
                <th
                  key={column}
                  className="min-w-36 border-b border-base-content/10 px-3 py-2.5 font-semibold text-base-content/50"
                >
                  {column}
                </th>
              ))}
              <th className="min-w-44 border-b border-base-content/10 px-3 py-2.5 text-base-content/40">Actions</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map(row => {
              const expanded = expandedRowId === row.id
              return (
                <RowWithDetails
                  key={row.id}
                  row={row}
                  columns={batch.columns}
                  expanded={expanded}
                  loading={loadingRowId === row.id}
                  history={historyByRowId[row.id] ?? null}
                  historyError={historyErrorByRowId[row.id] ?? null}
                  canRun={!isActive}
                  running={runningRowId === row.id}
                  responsePanelProps={responsePanelProps}
                  onToggle={() => void toggleRow(row)}
                  onRun={() => void runRow(row)}
                />
              )
            })}
          </tbody>
        </table>
        {!page.loading && page.rows.length === 0 ? (
          <div className="grid min-h-32 place-items-center text-sm text-base-content/40">
            {searchValue.trim() ? 'No rows match this search.' : 'This batch has no rows.'}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-base-content/10 bg-base-200/25 px-4 py-3 text-xs text-base-content/45">
        <span>
          Page {pageNumber} of {pageCount} · {page.totalRowCount} rows
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-base-content/10 px-3 py-1.5 font-medium text-base-content/60 disabled:opacity-35"
            disabled={page.loading || page.rowOffset === 0}
            onClick={() =>
              void RequestBatchCoordinator.loadPage(
                batch.id,
                page.rowSearchQuery,
                Math.max(0, page.rowOffset - REQUEST_BATCH_ROW_PAGE_SIZE)
              )
            }
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-lg border border-base-content/10 px-3 py-1.5 font-medium text-base-content/60 disabled:opacity-35"
            disabled={page.loading || page.nextRowOffset === null}
            onClick={() => {
              if (page.nextRowOffset !== null)
                void RequestBatchCoordinator.loadPage(batch.id, page.rowSearchQuery, page.nextRowOffset)
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

function RowWithDetails({
  row,
  columns,
  expanded,
  loading,
  history,
  historyError,
  canRun,
  running,
  responsePanelProps,
  onToggle,
  onRun,
}: {
  row: RequestBatchRowRecord
  columns: string[]
  expanded: boolean
  loading: boolean
  history: RequestExecutionRecord | null
  historyError: string | null
  canRun: boolean
  running: boolean
  responsePanelProps: Omit<RequestDetailsResponsePanelProps, 'isSending' | 'execution'>
  onToggle: () => void
  onRun: () => void
}) {
  const expandable = row.status === 'completed'
  return (
    <>
      <tr className={expandable ? 'cursor-pointer hover:bg-base-200/35' : 'hover:bg-base-200/20'} onClick={onToggle}>
        <td className="border-b border-base-content/7 px-3 py-2.5 text-base-content/35">
          <span className="inline-flex items-center gap-1">
            {expandable ? (
              expanded ? (
                <ChevronDownIcon className="size-3" />
              ) : (
                <ChevronRightIcon className="size-3" />
              )
            ) : null}
            {row.rowIndex + 1}
          </span>
        </td>
        <td className={`border-b border-base-content/7 px-3 py-2.5 font-medium ${getRowStatusClassName(row.status)}`}>
          {row.status}
        </td>
        {columns.map(column => (
          <td
            key={column}
            className="max-w-72 border-b border-base-content/7 px-3 py-2.5 font-mono text-[11px] text-base-content/65"
          >
            <div className="truncate" title={row.variables[column] ?? ''}>
              {row.variables[column] ?? ''}
            </div>
          </td>
        ))}
        <td className="border-b border-base-content/7 px-3 py-2.5 text-base-content/40">
          <div className="flex items-center justify-between gap-2">
            <span>{row.historyId ? <span title={row.historyId}>Saved · {row.historyId.slice(0, 8)}</span> : 'Not saved'}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-base-content/10 px-2 py-1 font-medium text-base-content/60 hover:bg-base-100 disabled:opacity-35"
              disabled={!canRun || running}
              onClick={event => {
                event.stopPropagation()
                onRun()
              }}
              title="Run this row"
            >
              <PlayIcon className="size-3" /> {running ? 'Starting...' : 'Run'}
            </button>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={columns.length + 3} className="border-b border-base-content/10 bg-base-200/20 px-4 py-4">
            {loading ? <div className="text-sm text-base-content/40">Loading request history...</div> : null}
            {!loading && history ? (
              <RequestDetailsResponsePanel key={history.id} {...responsePanelProps} isSending={false} execution={history} />
            ) : null}
            {!loading && !history ? (
              <div className="text-sm text-base-content/45">
                {historyError ??
                  (row.historyId ? 'Loading request history...' : 'No saved history is associated with this row.')}
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function BatchMetric({ label, value, tone = 'text-base-content' }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-base-content/8 bg-base-100/55 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-base-content/35">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function getBatchStatusClassName(status: RequestBatchRecord['status']) {
  switch (status) {
    case 'ready':
      return 'bg-base-content/8 text-base-content/55'
    case 'running':
      return 'bg-info/12 text-info'
    case 'completed':
      return 'bg-success/12 text-success'
    case 'failed':
      return 'bg-error/12 text-error'
    case 'cancelled':
      return 'bg-warning/12 text-warning'
    default:
      return Typescript.assertUnreachable(status)
  }
}

function getRowStatusClassName(status: RequestBatchRowRecord['status']) {
  switch (status) {
    case 'pending':
      return 'text-base-content/45'
    case 'running':
      return 'text-info'
    case 'completed':
      return 'text-success'
    case 'failed':
      return 'text-error'
    case 'cancelled':
      return 'text-warning'
    default:
      return Typescript.assertUnreachable(status)
  }
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record }
  delete next[key]
  return next
}
