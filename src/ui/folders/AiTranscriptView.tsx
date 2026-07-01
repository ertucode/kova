import { ChevronDownIcon, ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { type ScriptAiMessage, type ScriptAiMessagePart, type ScriptAiMessagePatchDiff } from '@common/ScriptAi'
import { Typescript } from '@common/Typescript'
import { clsx } from '@/lib/functions/clsx'
import { ScriptAiMergeEditor } from './ScriptAiMergeEditor'
import type { CodeEditorLanguage } from './CodeEditor'

export type AiTranscriptPatchDiffState = {
  isLoading: boolean
  errorMessage: string | null
  diffs: ScriptAiMessagePatchDiff[] | null
}

type AiTranscriptViewProps = {
  messages: ScriptAiMessage[]
  emptyMessage: string
  patchDiffStateByMessageId?: Record<string, AiTranscriptPatchDiffState | null | undefined>
}

type AssistantTranscriptRow =
  | { id: string; type: 'divider' }
  | { id: string; type: 'context-tools'; parts: Extract<ScriptAiMessagePart, { type: 'tool' }>[] }
  | { id: string; type: 'part'; messageId: string; part: ScriptAiMessagePart }

const CONTEXT_TOOL_NAMES = new Set(['read', 'glob', 'grep', 'list'])
const BUILTIN_TOOL_NAMES = new Set([
  'read',
  'glob',
  'grep',
  'list',
  'bash',
  'apply_patch',
  'edit',
  'write',
  'question',
  'skill',
  'task',
  'todowrite',
  'webfetch',
])

export function AiTranscriptView({ messages, emptyMessage, patchDiffStateByMessageId = {} }: AiTranscriptViewProps) {
  if (!messages.length) {
    return (
      <div className="grid h-full min-h-[180px] place-items-center px-4 text-center text-sm text-base-content/45">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {messages.map(message => (
        <TranscriptMessage
          key={message.id}
          message={message}
          patchDiffState={patchDiffStateByMessageId[message.id] ?? null}
        />
      ))}
    </div>
  )
}

function TranscriptMessage({
  message,
  patchDiffState,
}: {
  message: ScriptAiMessage
  patchDiffState: AiTranscriptPatchDiffState | null
}) {
  if (message.role === 'user') {
    return <UserMessageBubble message={message} />
  }

  return <AssistantMessageBlock message={message} patchDiffState={patchDiffState} />
}

function UserMessageBubble({ message }: { message: ScriptAiMessage }) {
  const text = message.parts
    .flatMap(part => {
      switch (part.type) {
        case 'text':
          return part.text.trim() ? [part.text] : []
        case 'file':
          return []
        case 'reasoning':
        case 'tool':
        case 'step-start':
        case 'step-finish':
        case 'snapshot':
        case 'patch':
        case 'agent':
        case 'subtask':
        case 'retry':
        case 'compaction':
          return []
        default:
          return Typescript.assertUnreachable(part)
      }
    })
    .join('\n\n')
    .trim()
  const attachments = message.parts.flatMap(part => {
    if (part.type !== 'file') {
      return []
    }

    const label = part.path ?? part.filename
    return label ? [label] : []
  })

  return (
    <div className="flex flex-col items-end gap-2">
      {attachments.length ? (
        <div className="flex max-w-[82%] flex-wrap justify-end gap-2">
          {attachments.map(attachment => (
            <span
              key={attachment}
              className="rounded-lg border border-base-content/10 bg-base-200/35 px-2.5 py-1 text-[11px] text-base-content/62"
            >
              {attachment}
            </span>
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="max-w-[82%] rounded-2xl bg-base-200/55 px-3 py-2 text-sm leading-6 text-base-content shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
          <div className="whitespace-pre-wrap break-words">{text}</div>
        </div>
      ) : null}
    </div>
  )
}

function AssistantMessageBlock({
  message,
  patchDiffState,
}: {
  message: ScriptAiMessage
  patchDiffState: AiTranscriptPatchDiffState | null
}) {
  const rows = getAssistantTranscriptRows(message)

  return (
    <div className="space-y-3">
      {rows.map(row => {
        switch (row.type) {
          case 'divider':
            return <TranscriptDivider key={row.id} />
          case 'context-tools':
            return <ContextToolGroup key={row.id} parts={row.parts} />
          case 'part':
            return (
              <AssistantPartRow
                key={row.id}
                part={row.part}
                patchDiffState={row.part.type === 'patch' ? patchDiffState : null}
              />
            )
          default:
            return Typescript.assertUnreachable(row)
        }
      })}
    </div>
  )
}

function AssistantPartRow({
  part,
  patchDiffState,
}: {
  part: ScriptAiMessagePart
  patchDiffState: AiTranscriptPatchDiffState | null
}) {
  switch (part.type) {
    case 'text':
      return <AssistantTextPart text={part.text} />
    case 'reasoning':
      return <ReasoningPart text={part.text} />
    case 'tool':
      return isApplyPatchToolPart(part) ? <ApplyPatchToolPart part={part} /> : <ToolPartRow part={part} />
    case 'patch':
      return <PatchPartRow part={part} patchDiffState={patchDiffState} />
    case 'file':
      return (
        <CompactDisclosure title="Attached file" subtitle={part.path ?? part.filename ?? 'File attachment'}>
          <CodeBlock>{part.path ?? part.filename ?? 'File attachment'}</CodeBlock>
        </CompactDisclosure>
      )
    case 'agent':
      return <MetaLine label="Agent" value={part.name} />
    case 'subtask':
      return (
        <CompactDisclosure title={`Subtask: ${part.description}`} subtitle={part.agent}>
          <CodeBlock>{part.prompt}</CodeBlock>
        </CompactDisclosure>
      )
    case 'retry':
      return <MetaLine label="Retry" value="Assistant retried this turn." />
    case 'snapshot':
      return <MetaLine label="Snapshot" value="Snapshot created." />
    case 'compaction':
      return <MessageDivider label="Compaction" />
    case 'step-start':
    case 'step-finish':
      return null
    default:
      return Typescript.assertUnreachable(part)
  }
}

function AssistantTextPart({ text }: { text: string }) {
  if (!text.trim()) {
    return null
  }

  return <div className="whitespace-pre-wrap break-words text-sm leading-7 text-base-content">{text}</div>
}

function ReasoningPart({ text }: { text: string }) {
  if (!text.trim()) {
    return null
  }

  return (
    <CompactDisclosure title="Reasoning" subtitle={getFirstLine(text)}>
      <CodeBlock className="text-base-content/60">{text}</CodeBlock>
    </CompactDisclosure>
  )
}

function ToolPartRow({ part }: { part: Extract<ScriptAiMessagePart, { type: 'tool' }> }) {
  const statusLabel = getToolStatusLabel(part.status)
  const detail = getToolPrimaryDetail(part)
  const body = getToolPartContent(part)
  const defaultOpen = part.status === 'error' || isMcpToolName(part.toolName)

  return (
    <CompactDisclosure
      title={part.title ?? getToolDisplayName(part.toolName)}
      subtitle={detail}
      meta={statusLabel}
      defaultOpen={defaultOpen}
      dimmed={part.status !== 'completed'}
    >
      <CodeBlock className="max-h-96 overflow-auto">{body}</CodeBlock>
    </CompactDisclosure>
  )
}

function ContextToolGroup({ parts }: { parts: Extract<ScriptAiMessagePart, { type: 'tool' }>[] }) {
  const readCount = parts.filter(part => part.toolName === 'read').length
  const searchCount = parts.filter(part => part.toolName === 'glob' || part.toolName === 'grep').length
  const listCount = parts.filter(part => part.toolName === 'list').length
  const summary = [
    readCount ? `${String(readCount)} read` : null,
    searchCount ? `${String(searchCount)} search` : null,
    listCount ? `${String(listCount)} list` : null,
  ]
    .filter(Boolean)
    .join(' • ')

  return (
    <CompactDisclosure title="Gathered context" subtitle={summary || `${String(parts.length)} tools`} dimmed>
      <div className="space-y-2">
        {parts.map(part => (
          <div key={part.id} className="rounded-xl border border-base-content/8 bg-base-200/15 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6">
              <span className="font-medium text-base-content">{getToolDisplayName(part.toolName)}</span>
              {getToolPrimaryDetail(part) ? (
                <span className="min-w-0 truncate text-base-content/58">{getToolPrimaryDetail(part)}</span>
              ) : null}
              <span className="text-[11px] uppercase tracking-[0.14em] text-base-content/38">
                {getToolStatusLabel(part.status)}
              </span>
            </div>
            {getContextToolArgs(part).length ? (
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-base-content/48">
                {getContextToolArgs(part).map(arg => (
                  <span key={arg}>{arg}</span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </CompactDisclosure>
  )
}

function PatchPartRow({
  part,
  patchDiffState,
}: {
  part: Extract<ScriptAiMessagePart, { type: 'patch' }>
  patchDiffState: AiTranscriptPatchDiffState | null
}) {
  const title = part.files.length === 1 ? 'Patch' : `Patch (${String(part.files.length)} files)`

  return (
    <CompactDisclosure title={title} subtitle={part.files.join(', ') || 'Workspace patch'}>
      {patchDiffState?.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-base-content/55">
          <LoaderCircleIcon className="size-4 animate-spin" />
          Loading patch diff...
        </div>
      ) : patchDiffState?.errorMessage ? (
        <div className="text-sm text-error">{patchDiffState.errorMessage}</div>
      ) : patchDiffState?.diffs?.length ? (
        <div className="space-y-3">
          {patchDiffState.diffs.map((diff, index) => (
            <PatchDiffCard key={`${diff.file ?? 'unknown'}-${String(index)}`} diff={diff} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {part.files.length ? (
            part.files.map(file => <PatchFileSummary key={file} path={file} />)
          ) : (
            <div className="text-sm text-base-content/55">No diff text available for this patch.</div>
          )}
        </div>
      )}
    </CompactDisclosure>
  )
}

function PatchDiffCard({ diff }: { diff: ScriptAiMessagePatchDiff }) {
  const path = diff.file ?? 'Unknown file'
  const subtitle = [
    diff.status ? capitalize(diff.status) : null,
    diff.additions ? `+${String(diff.additions)}` : null,
    diff.deletions ? `-${String(diff.deletions)}` : null,
  ]
    .filter(Boolean)
    .join(' • ')

  return (
    <CompactDisclosure title={path} subtitle={subtitle} defaultOpen={Boolean(diff.patch && diff.patch.length < 1200)}>
      <CodeBlock>{diff.patch ?? 'No patch body available.'}</CodeBlock>
    </CompactDisclosure>
  )
}

function ApplyPatchToolPart({ part }: { part: Extract<ScriptAiMessagePart, { type: 'tool' }> }) {
  const patchText = getApplyPatchText(part.input)
  const operations = patchText ? parseApplyPatchOperations(patchText) : []

  if (!operations.length) {
    return (
      <CompactDisclosure title={part.title ?? 'Apply patch'} subtitle={getToolStatusLabel(part.status)}>
        <CodeBlock>{patchText ?? 'No patch text available.'}</CodeBlock>
      </CompactDisclosure>
    )
  }

  return (
    <CompactDisclosure
      title={part.title ?? 'Apply patch'}
      subtitle={`${String(operations.length)} file${operations.length === 1 ? '' : 's'}`}
      meta={getToolStatusLabel(part.status)}
    >
      <div className="space-y-3">
        {operations.map((operation, index) => (
          <ApplyPatchOperationCard key={`${operation.path}-${String(index)}`} operation={operation} />
        ))}
      </div>
    </CompactDisclosure>
  )
}

function ApplyPatchOperationCard({ operation }: { operation: ParsedApplyPatchOperation }) {
  const changeSummary = [capitalize(operation.type), ...getApplyPatchChangeCounts(operation)].join(' • ')

  if (!operation.originalText && !operation.modifiedText) {
    return (
      <CompactDisclosure title={operation.path} subtitle={changeSummary} defaultOpen>
        <div className="text-sm text-base-content/55">No line diff available.</div>
      </CompactDisclosure>
    )
  }

  return (
    <CompactDisclosure title={operation.path} subtitle={changeSummary} defaultOpen>
      <div className="overflow-hidden rounded-xl border border-base-content/8 bg-base-100/60">
        <ScriptAiMergeEditor
          originalValue={operation.originalText}
          modifiedValue={operation.modifiedText}
          language={getCodeEditorLanguageForPath(operation.path)}
          onModifiedChange={() => undefined}
          readOnlyModified
        />
      </div>
    </CompactDisclosure>
  )
}

function PatchFileSummary({ path }: { path: string }) {
  return (
    <div className="rounded-xl border border-base-content/8 bg-base-200/15 px-3 py-2 text-sm text-base-content/72">
      {path}
    </div>
  )
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6">
      <span className="font-medium text-base-content">{label}</span>
      <span className="text-base-content/60">{value}</span>
    </div>
  )
}

function TranscriptDivider() {
  return <div className="border-t border-base-content/10" />
}

function MessageDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 text-[11px] uppercase tracking-[0.16em] text-base-content/36">
      <div className="h-px flex-1 bg-base-content/10" />
      <span>{label}</span>
      <div className="h-px flex-1 bg-base-content/10" />
    </div>
  )
}

function CompactDisclosure({
  title,
  subtitle,
  meta,
  children,
  defaultOpen = false,
  dimmed = false,
}: {
  title: string
  subtitle?: string | null
  meta?: string | null
  children: ReactNode
  defaultOpen?: boolean
  dimmed?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-2xl border border-base-content/8 bg-base-100/45">
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-3 px-3 py-2.5 text-left"
        onClick={() => setIsOpen(current => !current)}
      >
        <span className="mt-0.5 shrink-0 text-base-content/40">
          {isOpen ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm leading-6">
            <span className={clsx('font-medium', dimmed ? 'text-base-content/78' : 'text-base-content')}>
              {title}
            </span>
            {subtitle ? <span className="min-w-0 truncate text-base-content/52">{subtitle}</span> : null}
            {meta ? (
              <span className="text-[11px] uppercase tracking-[0.14em] text-base-content/36">{meta}</span>
            ) : null}
          </span>
        </span>
      </button>
      {isOpen ? <div className="border-t border-base-content/8 px-3 py-3">{children}</div> : null}
    </div>
  )
}

function CodeBlock({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={clsx(
        'overflow-auto whitespace-pre-wrap break-words rounded-xl bg-base-200/20 px-3 py-2 font-mono text-[12px] leading-5 text-base-content/72',
        className
      )}
    >
      {children}
    </pre>
  )
}

function getAssistantTranscriptRows(message: ScriptAiMessage): AssistantTranscriptRow[] {
  const rows: AssistantTranscriptRow[] = []
  let pendingContextParts: Extract<ScriptAiMessagePart, { type: 'tool' }>[] = []

  const flushContextParts = () => {
    if (!pendingContextParts.length) {
      return
    }

    rows.push({
      id: `${message.id}-${pendingContextParts[0]?.id ?? 'context'}`,
      type: 'context-tools',
      parts: pendingContextParts,
    })
    pendingContextParts = []
  }

  for (const part of message.parts) {
    if (part.type === 'step-start') {
      flushContextParts()
      rows.push({ id: `${message.id}-${part.id}-divider`, type: 'divider' })
      continue
    }

    if (part.type === 'step-finish') {
      flushContextParts()
      continue
    }

    if (isContextToolPart(part)) {
      pendingContextParts.push(part)
      continue
    }

    flushContextParts()
    rows.push({ id: `${message.id}-${part.id}`, type: 'part', messageId: message.id, part })
  }

  flushContextParts()
  return rows
}

function isContextToolPart(part: ScriptAiMessagePart): part is Extract<ScriptAiMessagePart, { type: 'tool' }> {
  return part.type === 'tool' && CONTEXT_TOOL_NAMES.has(part.toolName)
}

function getToolPrimaryDetail(part: Extract<ScriptAiMessagePart, { type: 'tool' }>) {
  if (part.toolName === 'read') {
    const input = parseJsonObject(part.input)
    const filePath = typeof input?.filePath === 'string' ? input.filePath : null
    const range = getReadToolRangeLabel(part.input)
    return [filePath, range].filter(Boolean).join(' • ')
  }

  const input = parseJsonObject(part.input)
  const candidates = [input?.description, input?.query, input?.url, input?.filePath, input?.path, input?.pattern, input?.name]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate
    }
  }

  if (part.errorMessage?.trim()) {
    return part.errorMessage
  }

  return null
}

function getContextToolArgs(part: Extract<ScriptAiMessagePart, { type: 'tool' }>) {
  const input = parseJsonObject(part.input)
  if (!input) {
    return []
  }

  const ignoredKeys = new Set(['description', 'query', 'url', 'filePath', 'path', 'pattern', 'name'])
  return Object.entries(input)
    .filter(([key, value]) => !ignoredKeys.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => `${key}=${String(value)}`)
}

function getToolPartContent(part: Extract<ScriptAiMessagePart, { type: 'tool' }>) {
  return (
    [part.input ? `Input:\n${part.input}` : null, part.output ? `Output:\n${part.output}` : null, part.errorMessage ? `Error:\n${part.errorMessage}` : null]
      .filter(Boolean)
      .join('\n\n') || 'No details yet.'
  )
}

function getReadToolRangeLabel(input: string | null) {
  const parsed = parseJsonObject(input)
  if (!parsed) {
    return null
  }

  const hasOffset = typeof parsed.offset === 'number' && Number.isFinite(parsed.offset)
  const hasLimit = typeof parsed.limit === 'number' && Number.isFinite(parsed.limit)
  if (!hasOffset && !hasLimit) {
    return null
  }

  return [hasOffset ? `offset ${String(parsed.offset)}` : null, hasLimit ? `limit ${String(parsed.limit)}` : null]
    .filter(Boolean)
    .join(' • ')
}

function parseJsonObject(input: string | null) {
  if (!input) {
    return null
  }

  try {
    const parsed = JSON.parse(input) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function getToolDisplayName(toolName: string) {
  return toolName.replace(/_/g, ' ')
}

function isMcpToolName(toolName: string) {
  return !BUILTIN_TOOL_NAMES.has(toolName)
}

function getToolStatusLabel(status: Extract<ScriptAiMessagePart, { type: 'tool' }>['status']) {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'error':
      return 'Error'
    default:
      return Typescript.assertUnreachable(status)
  }
}

function getFirstLine(value: string) {
  return value.trim().split('\n')[0] ?? ''
}

function isApplyPatchToolPart(part: ScriptAiMessagePart): part is Extract<ScriptAiMessagePart, { type: 'tool' }> {
  return part.type === 'tool' && part.toolName === 'apply_patch' && Boolean(getApplyPatchText(part.input))
}

function getApplyPatchText(input: string | null) {
  if (!input) {
    return null
  }

  const parsed = parseJsonObject(input)
  const patchText = parsed?.patchText
  if (typeof patchText === 'string' && patchText.trim()) {
    return patchText
  }

  const patchStartIndex = input.indexOf('*** Begin Patch')
  if (patchStartIndex >= 0) {
    return input.slice(patchStartIndex).trim()
  }

  return input.trim() || null
}

type ParsedApplyPatchOperation = {
  type: 'add' | 'update' | 'delete'
  path: string
  originalText: string
  modifiedText: string
  additions: number
  deletions: number
}

function parseApplyPatchOperations(patchText: string): ParsedApplyPatchOperation[] {
  const lines = patchText.split('\n')
  const operations: ParsedApplyPatchOperation[] = []
  let currentOperation: ParsedApplyPatchOperation | null = null
  let currentOriginalLines: string[] = []
  let currentModifiedLines: string[] = []
  let isInHunk = false

  const flushCurrentOperation = () => {
    if (!currentOperation) {
      return
    }

    currentOperation.originalText = trimTrailingEmptyLines(currentOriginalLines).join('\n')
    currentOperation.modifiedText = trimTrailingEmptyLines(currentModifiedLines).join('\n')
    operations.push(currentOperation)
    currentOperation = null
    currentOriginalLines = []
    currentModifiedLines = []
    isInHunk = false
  }

  for (const line of lines) {
    if (line.startsWith('*** Add File: ')) {
      flushCurrentOperation()
      currentOperation = {
        type: 'add',
        path: line.slice('*** Add File: '.length).trim(),
        originalText: '',
        modifiedText: '',
        additions: 0,
        deletions: 0,
      }
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      flushCurrentOperation()
      currentOperation = {
        type: 'update',
        path: line.slice('*** Update File: '.length).trim(),
        originalText: '',
        modifiedText: '',
        additions: 0,
        deletions: 0,
      }
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      flushCurrentOperation()
      currentOperation = {
        type: 'delete',
        path: line.slice('*** Delete File: '.length).trim(),
        originalText: '',
        modifiedText: '',
        additions: 0,
        deletions: 0,
      }
      continue
    }

    if (line.startsWith('*** Move to: ') || line === '*** Begin Patch' || line === '*** End Patch') {
      continue
    }

    if (!currentOperation) {
      continue
    }

    if (line.startsWith('@@')) {
      isInHunk = true
      continue
    }

    if (currentOperation.type === 'add') {
      if (line.startsWith('+')) {
        currentModifiedLines.push(line.slice(1))
        currentOperation.additions += 1
      }
      continue
    }

    if (currentOperation.type === 'delete') {
      continue
    }

    if (!isInHunk) {
      continue
    }

    if (line.startsWith('+')) {
      currentModifiedLines.push(line.slice(1))
      currentOperation.additions += 1
      continue
    }

    if (line.startsWith('-')) {
      currentOriginalLines.push(line.slice(1))
      currentOperation.deletions += 1
      continue
    }

    if (line.startsWith(' ')) {
      const value = line.slice(1)
      currentOriginalLines.push(value)
      currentModifiedLines.push(value)
    }
  }

  flushCurrentOperation()
  return operations
}

function trimTrailingEmptyLines(lines: string[]) {
  const nextLines = [...lines]
  while (nextLines.length > 0 && nextLines.at(-1) === '') {
    nextLines.pop()
  }
  return nextLines
}

function getApplyPatchChangeCounts(operation: ParsedApplyPatchOperation) {
  return [operation.additions ? `+${String(operation.additions)}` : null, operation.deletions ? `-${String(operation.deletions)}` : null].filter(Boolean)
}

function getCodeEditorLanguageForPath(path: string): CodeEditorLanguage {
  if (path.endsWith('.jsx') || path.endsWith('.tsx')) {
    return 'jsx'
  }

  if (path.endsWith('.js') || path.endsWith('.ts') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
    return 'javascript'
  }

  if (path.endsWith('.json')) {
    return 'json'
  }

  if (path.endsWith('.json5')) {
    return 'json5'
  }

  if (path.endsWith('.html')) {
    return 'html'
  }

  if (path.endsWith('.css')) {
    return 'css'
  }

  if (path.endsWith('.xml') || path.endsWith('.svg')) {
    return 'xml'
  }

  return 'plain'
}

function capitalize(value: string) {
  return value ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}` : value
}
