import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from 'lucide-react'
import { getSseEventDisplayName } from '@common/Sse'
import type { SseEventRecord } from '@common/Requests'

export function SseTranscript({
  events,
  emptyMessage,
  showTimestamps = false,
}: {
  events: SseEventRecord[]
  emptyMessage: string
  showTimestamps?: boolean
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-6 text-sm text-base-content/45">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <SseTranscriptRow key={`${event.timestamp ?? 'history'}-${index}-${event.id ?? 'no-id'}`} event={event} showTimestamps={showTimestamps} />
      ))}
    </div>
  )
}

function SseTranscriptRow({ event, showTimestamps }: { event: SseEventRecord; showTimestamps: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const eventName = getSseEventDisplayName(event)

  return (
    <div className="rounded-2xl border border-base-content/10 bg-base-100/55">
      <div className="flex min-w-0 items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          className="mt-0.5 shrink-0 text-base-content/45 transition hover:text-base-content/70"
          onClick={() => setExpanded(current => !current)}
        >
          {expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/45">
            <span className="text-info">{eventName}</span>
            {event.id ? <span>ID {event.id}</span> : null}
            <span>{formatBytes(event.sizeBytes)}</span>
            {event.retryMs !== null ? <span>Retry {event.retryMs} ms</span> : null}
            {showTimestamps && event.timestamp !== null ? <span>{formatTimestamp(event.timestamp)}</span> : null}
          </div>
          {expanded ? (
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-base-content">
              {event.data || '(empty)'}
            </pre>
          ) : (
            <div className="mt-1 truncate font-mono text-xs text-base-content/75">{getCollapsedPreview(event.data)}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
            onClick={() => void navigator.clipboard.writeText(event.data)}
            title="Copy event data"
          >
            <CopyIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

function getCollapsedPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '(empty)'
  }

  return normalized.length > 60 ? `${normalized.slice(0, 60)}...` : normalized
}
