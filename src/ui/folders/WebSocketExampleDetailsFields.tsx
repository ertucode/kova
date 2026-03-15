import { useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import type { WebSocketExampleDetailsDraft } from './folderExplorerTypes'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { HeadersEditor } from './HeadersEditor'
import { CodeEditor } from './CodeEditor'

export function WebSocketExampleDetailsFields({ draft }: { draft: WebSocketExampleDetailsDraft }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <HeadersEditor value={draft.requestHeaders} onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestHeaders: value })} />

      <section className="w-full border-b border-base-content/10">
        <DetailsSectionHeader title="Request Body" />
        <CodeEditor
          value={draft.requestBody}
          language="plain"
          size="small"
          minHeightClassName="min-h-32"
          className="border-x-0 border-b-0"
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestBody: value })}
        />
      </section>

      <section className="min-h-0 flex-1">
        <DetailsSectionHeader title="Transcript" />
        <div className="space-y-2 p-3">
          {draft.messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-content/10 px-3 py-3 text-sm text-base-content/40">No messages saved</div>
          ) : (
            draft.messages.map(message => <WebSocketExampleMessageRow key={message.id} message={message} />)
          )}
        </div>
      </section>
    </div>
  )
}

function WebSocketExampleMessageRow({ message }: { message: WebSocketExampleDetailsDraft['messages'][number] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/60 px-3 py-3">
      <button type="button" className="flex w-full min-w-0 items-start gap-2 text-left" onClick={() => setExpanded(current => !current)}>
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

function getCollapsedMessagePreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '(empty)'
  }

  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}
