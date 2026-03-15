import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import { ChevronDownIcon, ChevronRightIcon, SaveIcon, SearchIcon, TerminalSquareIcon, Trash2Icon } from 'lucide-react'
import type { RequestConsoleEntry, RequestExecutionRecord, RequestHistoryListItem, WebSocketSessionRecord } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { toast } from '@/lib/components/toast'
import { RequestExecutionCoordinator, requestExecutionStore } from './requestExecutionStore'

export function HistoryPanel() {
  const history = useSelector(requestExecutionStore, state => state.context.history)
  const historyLoaded = useSelector(requestExecutionStore, state => state.context.historyLoaded)
  const historyLoading = useSelector(requestExecutionStore, state => state.context.historyLoading)
  const historyLoadingMore = useSelector(requestExecutionStore, state => state.context.historyLoadingMore)
  const historyNextOffset = useSelector(requestExecutionStore, state => state.context.historyNextOffset)
  const historySearchQuery = useSelector(requestExecutionStore, state => state.context.historySearchQuery)
  const historyKeepLast = useSelector(requestExecutionStore, state => state.context.historyKeepLast)
  const visibleHistory = useMemo(() => history.filter(isRenderableExecution), [history])
  const [searchValue, setSearchValue] = useState(historySearchQuery)

  useEffect(() => {
    void RequestExecutionCoordinator.ensureHistoryLoaded()
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchValue === requestExecutionStore.getSnapshot().context.historySearchQuery) {
        return
      }

      RequestExecutionCoordinator.setSearchQuery(searchValue)
      void RequestExecutionCoordinator.refreshHistory()
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [searchValue])

  return (
    <ExecutionPanelShell title="History" description="Requests, responses, variables, and script logs are stored here.">
      <HistoryToolbar
        searchValue={searchValue}
        keepLast={historyKeepLast}
        onSearchChange={setSearchValue}
        onKeepLastChange={value => RequestExecutionCoordinator.setKeepLast(value)}
        onTrimNow={() => void RequestExecutionCoordinator.trimHistory()}
      />

      {!historyLoaded && historyLoading ? <EmptyExecutionState message="Loading history..." /> : null}
      {historyLoaded && visibleHistory.length === 0 ? (
        <EmptyExecutionState message={searchValue.trim() ? 'No history matches your search.' : 'Send a request to start building history.'} />
      ) : null}
      {visibleHistory.map(execution => (
        execution.itemType === 'http'
          ? <ExecutionCard key={execution.id} execution={execution} />
          : <WebSocketHistoryCard key={execution.id} session={execution} />
      ))}
      {historyNextOffset !== null ? (
        <button
          type="button"
          className="rounded-2xl border border-base-content/10 bg-base-100/60 px-4 py-3 text-sm font-medium text-base-content/70 transition hover:border-base-content/20 hover:bg-base-100 hover:text-base-content"
          onClick={() => void RequestExecutionCoordinator.loadNextHistory()}
          disabled={historyLoadingMore}
        >
          {historyLoadingMore ? 'Loading...' : 'Load next'}
        </button>
      ) : null}
    </ExecutionPanelShell>
  )
}

function HistoryToolbar({
  searchValue,
  keepLast,
  onSearchChange,
  onKeepLastChange,
  onTrimNow,
}: {
  searchValue: string
  keepLast: number
  onSearchChange: (value: string) => void
  onKeepLastChange: (value: number) => void
  onTrimNow: () => void
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-base-content/10 bg-base-100/50 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
      <label className="flex items-center gap-3 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5">
        <SearchIcon className="size-4 shrink-0 text-base-content/40" />
        <input
          value={searchValue}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="Search all history"
          className="w-full border-0 bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/35"
        />
      </label>

      <label className="flex items-center gap-3 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/45">Keep last</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={keepLast}
          onChange={event => onKeepLastChange(event.target.valueAsNumber)}
          className="w-full border-0 bg-transparent text-sm text-base-content outline-none"
        />
      </label>

      <button
        type="button"
        className="rounded-xl border border-base-content/10 bg-base-100 px-4 py-2.5 text-sm font-medium text-base-content/75 transition hover:border-base-content/20 hover:bg-base-200/70 hover:text-base-content"
        onClick={() => {
          void Promise.resolve(onTrimNow()).catch(error => {
            console.error('trimHistory failed', error)
          })
        }}
      >
        Trim now
      </button>
    </div>
  )
}

function ExecutionPanelShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-w-0 flex-col px-6 py-6">
      <div className="text-sm font-semibold text-base-content">{title}</div>
      <div className="mt-2 text-sm leading-6 text-base-content/45">{description}</div>
      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">{children}</div>
    </div>
  )
}

function EmptyExecutionState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">{message}</div>
}

function ExecutionCard({ execution }: { execution: RequestExecutionRecord }) {
  const [expanded, setExpanded] = useState(false)
  const [responseBodyExpanded, setResponseBodyExpanded] = useState(true)
  const tone = getExecutionTone(execution)
  const requestTime = useMemo(() => formatTimestamp(execution.request.sentAt), [execution.request.sentAt])
  const consoleEntries = execution.consoleEntries ?? []
  const scriptErrors = execution.scriptErrors ?? []

  return (
    <div className="min-w-0 shrink-0 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/50">
      <div className="flex items-start gap-2 px-4 py-3 transition hover:bg-base-100/60">
        <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setExpanded(current => !current)}>
          <div className="mt-0.5 text-base-content/45">{expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`text-xs font-semibold tracking-[0.12em] ${tone}`}>{execution.request.method}</span>
              <span className="truncate text-sm font-medium text-base-content">{execution.requestName}</span>
              <span className="truncate text-sm text-base-content/50">{execution.request.url}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/45">
              <span>{requestTime}</span>
              {execution.response ? (
                <span>
                  {execution.response.status} {execution.response.statusText}
                </span>
              ) : null}
              {execution.response ? <span>{execution.response.durationMs} ms</span> : null}
              {execution.responseError ? <span className="text-error">{execution.responseError}</span> : null}
              {consoleEntries.length > 0 ? <span>{consoleEntries.length} logs</span> : null}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-xl p-2 text-base-content/35 transition hover:bg-base-100/80 hover:text-base-content"
            onClick={event => {
              event.stopPropagation()
              void saveExecutionAsExample(execution)
            }}
            aria-label="Save as example"
            title="Save as Example"
          >
            <SaveIcon className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-xl p-2 text-base-content/35 transition hover:bg-error/10 hover:text-error"
            onClick={event => {
              event.stopPropagation()
              void RequestExecutionCoordinator.deleteHistoryEntry(execution.id).catch(error => {
                console.error('deleteHistoryEntry failed', error)
              })
            }}
            aria-label="Delete history entry"
            title="Delete history entry"
          >
            <Trash2Icon className="size-4" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="max-h-[500px] min-w-0 overflow-y-auto border-t border-base-content/10 px-4 py-4">
          <ConsoleEntriesSection entries={consoleEntries} />
          <ExecutionSection title="Request" value={formatExecutionRequest(execution)} />
          <ExecutionVariablesSection variables={execution.request.variables ?? {}} />
          <ExecutionResponseSection
            execution={execution}
            bodyExpanded={responseBodyExpanded}
            onToggleBody={() => setResponseBodyExpanded(current => !current)}
          />
          {scriptErrors.length > 0 ? (
            <ExecutionSection
              title="Script Errors"
              value={scriptErrors.map(error => `${error.sourceName}: ${error.message}`).join('\n')}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function WebSocketHistoryCard({ session }: { session: WebSocketSessionRecord }) {
  const [expanded, setExpanded] = useState(false)
  const connectedTime = useMemo(() => formatTimestamp(session.connectedAt), [session.connectedAt])

  return (
    <div className="min-w-0 shrink-0 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/50">
      <div className="flex items-start gap-2 px-4 py-3 transition hover:bg-base-100/60">
        <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setExpanded(current => !current)}>
          <div className="mt-0.5 text-base-content/45">{expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-semibold tracking-[0.12em] text-accent">WS</span>
              <span className="truncate text-sm font-medium text-base-content">{session.requestName}</span>
              <span className="truncate text-sm text-base-content/50">{session.url}</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-3 overflow-hidden text-xs text-base-content/45">
              <span>{connectedTime}</span>
              <span>{session.messages.length} messages</span>
              <span>{formatBytes(session.historySizeBytes)}</span>
              {session.closeCode !== null ? <span>Code {session.closeCode}</span> : null}
              {session.responseError ? <span className="truncate text-error">{session.responseError}</span> : null}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-xl p-2 text-base-content/35 transition hover:bg-base-100/80 hover:text-base-content"
            onClick={event => {
              event.stopPropagation()
              void saveWebSocketSessionAsExample(session)
            }}
            aria-label="Save as example"
            title="Save as Example"
          >
            <SaveIcon className="size-4" />
          </button>
          <button
            type="button"
            className="rounded-xl p-2 text-base-content/35 transition hover:bg-error/10 hover:text-error"
            onClick={event => {
              event.stopPropagation()
              void RequestExecutionCoordinator.deleteHistoryEntry(session.id).catch(error => {
                console.error('deleteHistoryEntry failed', error)
              })
            }}
            aria-label="Delete history entry"
            title="Delete history entry"
          >
            <Trash2Icon className="size-4" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="max-h-[500px] min-w-0 overflow-y-auto border-t border-base-content/10 px-4 py-4">
          <ExecutionSection title="Connection" value={formatWebSocketConnection(session)} />
          <ExecutionVariablesSection variables={session.requestVariables ?? {}} />
          <div className="mb-4 last:mb-0">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Messages</div>
            <div className="space-y-2">
              {session.messages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-content/10 px-3 py-3 text-sm text-base-content/40">No messages saved</div>
              ) : (
                session.messages.map(message => (
                  <HistoryWebSocketMessageRow key={message.id} message={message} />
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ConsoleEntriesSection({ entries }: { entries: RequestConsoleEntry[] }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">
        <TerminalSquareIcon className="size-3.5" /> Console
      </div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-content/10 px-3 py-3 text-sm text-base-content/40">No script logs</div>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border border-base-content/10 bg-base-100/60">
          {entries.map(entry => (
            <div key={entry.id} className="border-b border-base-content/10 px-3 py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-base-content/45">
                <span className={getConsoleTone(entry.level)}>{entry.level}</span>
                <span>{entry.sourceName}</span>
                <span>{formatTimestamp(entry.timestamp)}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content">{entry.message}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExecutionSection({ title, value }: { title: string; value: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">{title}</div>
      <pre
        className="min-w-0 overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content"
        style={{ maxHeight: '500px' }}
      >
        {value || '(empty)'}
      </pre>
    </div>
  )
}

function ExecutionVariablesSection({ variables }: { variables: Record<string, string> }) {
  const entries = Object.entries(variables)

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Variables</div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-content/10 px-3 py-3 text-sm text-base-content/40">
          No variables used
        </div>
      ) : (
        <div className="min-w-0 overflow-auto rounded-xl border border-base-content/10 bg-base-100/60" style={{ maxHeight: '500px' }}>
          <div className="grid min-w-0 grid-cols-[minmax(0,180px)_minmax(0,1fr)] border-b border-base-content/10 bg-base-200/35 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
            <span>Name</span>
            <span>Value</span>
          </div>
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid min-w-0 grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-3 border-b border-base-content/10 px-3 py-2 last:border-b-0"
            >
              <span className="truncate font-mono text-[12px] leading-5 text-base-content/70">{key}</span>
              <span className="whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ExecutionResponseSection({
  execution,
  bodyExpanded,
  onToggleBody,
}: {
  execution: RequestExecutionRecord
  bodyExpanded: boolean
  onToggleBody: () => void
}) {
  if (execution.responseError) {
    return <ExecutionSection title="Response" value={execution.responseError} />
  }

  if (!execution.response) {
    return <ExecutionSection title="Response" value="" />
  }

  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">Response</div>
      <div className="space-y-3">
        <pre
          className="min-w-0 overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content"
          style={{ maxHeight: '500px' }}
        >
          {`${execution.response.status} ${execution.response.statusText} (${execution.response.durationMs} ms)`}
        </pre>
        {execution.response.headers ? <ExecutionSubsection title="Headers" value={execution.response.headers} /> : null}
        <ExecutionCollapsiblePreSection
          title="Body"
          value={execution.response.body}
          expanded={bodyExpanded}
          onToggle={onToggleBody}
          emptyValueMessage={execution.response.bodyOmitted ? 'Body omitted from history (over 500 KB)' : '(empty)'}
        />
      </div>
    </div>
  )
}

async function saveExecutionAsExample(execution: RequestExecutionRecord) {
  if (!execution.response) {
    return
  }

  const result = await getWindowElectron().createRequestExample({
    requestId: execution.requestId,
    name: `${execution.requestName} ${execution.response.status}`,
    requestHeaders: execution.request.headers,
    requestBody: execution.request.body,
    requestBodyType: execution.request.bodyType,
    requestRawType: execution.request.rawType,
    responseStatus: execution.response.status,
    responseStatusText: execution.response.statusText,
    responseHeaders: execution.response.headers,
    responseBody: execution.response.body,
  })

  if (!result.success) {
    toast.show(result)
    return
  }

  await FolderExplorerCoordinator.loadItems()
  FolderExplorerCoordinator.selectItem({ itemType: 'example', id: result.data.id })
  toast.show({ severity: 'success', title: 'Example saved', message: `Saved response example for ${execution.requestName}.` })
}

async function saveWebSocketSessionAsExample(session: WebSocketSessionRecord) {
  const lastSentMessage = [...session.messages].reverse().find(message => message.direction === 'sent')
  const result = await getWindowElectron().createWebSocketExample({
    requestId: session.requestId,
    name: `${session.requestName} ${formatTimestamp(session.connectedAt)}`,
    requestHeaders: session.requestHeaders,
    requestBody: lastSentMessage?.body ?? '',
    messages: session.messages.map(message => ({
      direction: message.direction,
      body: message.body,
      mimeType: message.mimeType,
      sizeBytes: message.sizeBytes,
      timestamp: message.timestamp,
    })),
  })

  if (!result.success) {
    toast.show(result)
    return
  }

  await FolderExplorerCoordinator.loadItems()
  FolderExplorerCoordinator.selectItem({ itemType: 'example', id: result.data.id })
  toast.show({ severity: 'success', title: 'Example saved', message: `Saved transcript example for ${session.requestName}.` })
}

function ExecutionSubsection({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{title}</div>
      <pre
        className="min-w-0 overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content"
        style={{ maxHeight: '500px' }}
      >
        {value || '(empty)'}
      </pre>
    </div>
  )
}

function ExecutionCollapsiblePreSection({
  title,
  value,
  expanded,
  onToggle,
  emptyValueMessage,
}: {
  title: string
  value: string
  expanded: boolean
  onToggle: () => void
  emptyValueMessage?: string
}) {
  return (
    <div>
      <button
        type="button"
        className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45 transition hover:text-base-content/70"
        onClick={onToggle}
      >
        {expanded ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        <span>{title}</span>
      </button>
      {expanded ? (
        <pre
          className="min-w-0 overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content"
          style={{ maxHeight: '500px' }}
        >
          {value || emptyValueMessage || '(empty)'}
        </pre>
      ) : null}
    </div>
  )
}

function formatExecutionRequest(execution: RequestExecutionRecord) {
  return [
    `${execution.request.method} ${execution.request.url}`,
    execution.request.headers ? `\nHeaders\n${execution.request.headers}` : '',
    execution.request.body ? `\nBody\n${execution.request.body}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getExecutionTone(execution: RequestExecutionRecord) {
  if (execution.responseError) {
    return 'text-error'
  }

  if (!execution.response) {
    return 'text-base-content/55'
  }

  if (execution.response.status >= 200 && execution.response.status < 300) {
    return 'text-success'
  }

  if (execution.response.status >= 400) {
    return 'text-error'
  }

  return 'text-info'
}

function getConsoleTone(level: RequestConsoleEntry['level']) {
  switch (level) {
    case 'error':
      return 'text-error'
    case 'warn':
      return 'text-warning'
    case 'info':
      return 'text-info'
    case 'debug':
      return 'text-secondary'
    default:
      return 'text-base-content/60'
  }
}

function isRenderableExecution(value: RequestHistoryListItem | null | undefined): value is RequestHistoryListItem {
  return Boolean(
    value && typeof value.id === 'string' && (value.itemType === 'http' ? value.request && typeof value.request.url === 'string' : typeof value.url === 'string')
  )
}

function formatWebSocketConnection(session: WebSocketSessionRecord) {
  return [
    session.url,
    `Connected ${formatTimestamp(session.connectedAt)}`,
    session.disconnectedAt ? `Disconnected ${formatTimestamp(session.disconnectedAt)}` : '',
    session.closeCode !== null ? `Close Code ${session.closeCode}` : '',
    session.closeReason ? `Close Reason ${session.closeReason}` : '',
  ].filter(Boolean).join('\n')
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function getCollapsedMessagePreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '(empty)'
  }

  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

function HistoryWebSocketMessageRow({ message }: { message: WebSocketSessionRecord['messages'][number] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3">
      <button type="button" className="flex min-w-0 w-full items-start gap-2 text-left" onClick={() => setExpanded(current => !current)}>
        <div className="mt-0.5 shrink-0 text-base-content/45">{expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-base-content/45">
            <span className={message.direction === 'sent' ? 'text-info' : 'text-success'}>{message.direction}</span>
            <span>{formatTimestamp(message.timestamp)}</span>
            <span>{formatBytes(message.sizeBytes)}</span>
            {message.mimeType ? <span>{message.mimeType}</span> : null}
          </div>
          {expanded ? (
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-base-content">{message.body || '(empty)'}</pre>
          ) : (
            <div className="mt-1 truncate font-mono text-[12px] text-base-content/75">{getCollapsedMessagePreview(message.body)}</div>
          )}
        </div>
      </button>
    </div>
  )
}
