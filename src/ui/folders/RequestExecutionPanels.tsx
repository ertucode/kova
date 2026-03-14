import { useMemo, useState, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import { ChevronDownIcon, ChevronRightIcon, TerminalSquareIcon } from 'lucide-react'
import type { RequestConsoleEntry, RequestExecutionRecord } from '@common/Requests'
import { requestExecutionStore } from './requestExecutionStore'

export function HistoryPanel() {
  const history = useSelector(requestExecutionStore, state => state.context.history)
  const visibleHistory = useMemo(() => history.filter(isRenderableExecution), [history])

  return (
    <ExecutionPanelShell title="History" description="Actual requests and responses are recorded here.">
      {visibleHistory.length === 0 ? (
        <EmptyExecutionState message="Send a request to start building history." />
      ) : (
        visibleHistory.map(execution => <ExecutionCard key={execution.id} execution={execution} mode="history" />)
      )}
    </ExecutionPanelShell>
  )
}

export function ConsolePanel() {
  const history = useSelector(requestExecutionStore, state => state.context.history)
  const visibleHistory = useMemo(() => history.filter(isRenderableExecution), [history])

  return (
    <ExecutionPanelShell title="Console" description="Script logs and execution details appear here.">
      {visibleHistory.length === 0 ? (
        <EmptyExecutionState message="Run a request with scripts to see console output." />
      ) : (
        visibleHistory.map(execution => <ExecutionCard key={execution.id} execution={execution} mode="console" />)
      )}
    </ExecutionPanelShell>
  )
}

function ExecutionPanelShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="text-sm font-semibold text-base-content">{title}</div>
      <div className="mt-2 text-sm leading-6 text-base-content/45">{description}</div>
      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">{children}</div>
    </div>
  )
}

function EmptyExecutionState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">{message}</div>
}

function ExecutionCard({ execution, mode }: { execution: RequestExecutionRecord; mode: 'history' | 'console' }) {
  const [expanded, setExpanded] = useState(mode === 'console')
  const [responseBodyExpanded, setResponseBodyExpanded] = useState(true)
  const tone = getExecutionTone(execution)
  const requestTime = useMemo(() => formatTimestamp(execution.request.sentAt), [execution.request.sentAt])
  const consoleEntries = execution.consoleEntries ?? []
  const scriptErrors = execution.scriptErrors ?? []

  return (
    <div className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/50">
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-base-100/60"
        onClick={() => setExpanded(current => !current)}
      >
        <div className="mt-0.5 text-base-content/45">{expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`text-xs font-semibold tracking-[0.12em] ${tone}`}>{execution.request.method}</span>
            <span className="truncate text-sm font-medium text-base-content">{execution.requestName}</span>
            <span className="truncate text-sm text-base-content/50">{execution.request.url}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/45">
            <span>{requestTime}</span>
            {execution.response ? <span>{execution.response.durationMs} ms</span> : null}
            {execution.response ? <span>{execution.response.status} {execution.response.statusText}</span> : null}
            {execution.responseError ? <span className="text-error">{execution.responseError}</span> : null}
            {mode === 'console' ? <span>{consoleEntries.length} logs</span> : null}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="max-h-[500px] overflow-y-auto border-t border-base-content/10 px-4 py-4">
          {mode === 'console' ? <ConsoleEntriesSection entries={consoleEntries} /> : null}
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

function ConsoleEntriesSection({ entries }: { entries: RequestConsoleEntry[] }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/50">
        <TerminalSquareIcon className="size-3.5" /> Console
      </div>
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-content/10 px-3 py-3 text-sm text-base-content/40">No script logs</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-base-content/10 bg-base-100/60">
          {entries.map(entry => (
            <div key={entry.id} className="border-b border-base-content/10 px-3 py-2 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-base-content/45">
                <span className={getConsoleTone(entry.level)}>{entry.level}</span>
                <span>{entry.sourceName}</span>
                <span>{formatTimestamp(entry.timestamp)}</span>
              </div>
              <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content">{entry.message}</pre>
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
        className="overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content"
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
        <div className="overflow-auto rounded-xl border border-base-content/10 bg-base-100/60" style={{ maxHeight: '500px' }}>
          <div className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] border-b border-base-content/10 bg-base-200/35 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">
            <span>Name</span>
            <span>Value</span>
          </div>
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-3 border-b border-base-content/10 px-3 py-2 last:border-b-0"
            >
              <span className="truncate font-mono text-[12px] leading-5 text-base-content/70">{key}</span>
              <span className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content">{value}</span>
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
          className="overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content"
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
        />
      </div>
    </div>
  )
}

function ExecutionSubsection({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">{title}</div>
      <pre
        className="overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content"
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
}: {
  title: string
  value: string
  expanded: boolean
  onToggle: () => void
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
          className="overflow-auto rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-base-content"
          style={{ maxHeight: '500px' }}
        >
          {value || '(empty)'}
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

function isRenderableExecution(value: RequestExecutionRecord | null | undefined): value is RequestExecutionRecord {
  return Boolean(value && typeof value.id === 'string' && value.request && typeof value.request.url === 'string')
}
