import {
  getPrimaryScriptAiPhase,
  type ScriptAiSessionSummary,
  getScriptAiTargetKey,
  type ScriptAiMessagePatchDiff,
  type ScriptAiMessagePart,
  type ScriptAiTarget,
} from '@common/ScriptAi'
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon, SparklesIcon, SquareIcon } from 'lucide-react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { buildScriptDocumentationPromptForTarget, getScriptDocumentationForTarget } from './scriptDocumentation'
import { appSettingsStore } from '@/global/appSettingsStore'
import { useOpenCodeModels } from '@/global/useOpenCodeModels'
import { ScriptAiMergeEditor } from './ScriptAiMergeEditor'
import type { CodeEditorLanguage } from './CodeEditor'
import { clsx } from '@/lib/functions/clsx'
import { getPatchDiffKey, scriptAiReviewStore, ScriptAiReviewCoordinator } from './scriptAiReviewStore'

type ScriptAiReviewDialogProps = {
  target: ScriptAiTarget
  currentCode: string
  onApply: (nextCode: string) => Promise<boolean | void> | boolean | void
}

type TranscriptRow =
  | {
      id: string
      type: 'divider'
    }
  | {
      id: string
      type: 'part'
      messageId: string
      part: ScriptAiMessagePart
    }

export function openScriptAiReviewDialog(props: ScriptAiReviewDialogProps) {
  dialogActions.open({ component: ScriptAiReviewDialog, props })
}

export function ScriptAiReviewDialog({ target, currentCode, onApply }: ScriptAiReviewDialogProps) {
  const appDefaultModel = useSelector(appSettingsStore, state => state.context.settings?.scriptAiModel ?? null)
  const {
    models: openCodeModels,
    modelInfoById,
    loading: modelsLoading,
    error: modelsError,
  } = useOpenCodeModels()
  const [isDiffDialogOpen, setIsDiffDialogOpen] = useState(false)
  const [isSessionDialogOpen, setIsSessionDialogOpen] = useState(false)
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(null)
  const [promptHistoryDraft, setPromptHistoryDraft] = useState('')
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  const documentation = getScriptDocumentationForTarget(target)
  const targetKey = getScriptAiTargetKey(target)
  const primaryPhase = getPrimaryScriptAiPhase(target.runtimeContext)
  const editorLanguage =
    primaryPhase === 'response-visualizer' || primaryPhase === 'view-runtime' ? 'jsx' : 'javascript'
  const reviewEntry = useSelector(scriptAiReviewStore, state => state.context.entriesByTargetKey[targetKey] ?? null)
  const workspaceState = reviewEntry?.workspaceState ?? null
  const isLoading = reviewEntry?.isLoading ?? false
  const isSubmitting = reviewEntry?.isSubmitting ?? false
  const errorMessage = reviewEntry?.errorMessage ?? null
  const selectedModel = reviewEntry?.selectedModel ?? appDefaultModel ?? ''
  const selectedSessionId = reviewEntry?.selectedSessionId ?? null
  const prompt = reviewEntry?.prompt ?? ''
  const promptHistory = reviewEntry?.promptHistory ?? []
  const patchDiffsByMessageKey = reviewEntry?.patchDiffsByMessageKey ?? {}
  const selectedSession = workspaceState?.sessions.find(session => session.id === selectedSessionId) ?? null
  const selectedSessionContextStats = getSelectedSessionContextStats(
    selectedSession,
    selectedModel,
    modelInfoById
  )
  const selectedMessages = selectedSessionId ? (workspaceState?.messagesBySessionId[selectedSessionId] ?? []) : []
  const transcriptRows: TranscriptRow[] = selectedMessages.flatMap(message =>
    message.parts.flatMap<TranscriptRow>(part => {
      if (part.type === 'step-start') {
        return [{ id: `${message.id}-${part.id}-divider`, type: 'divider' as const }]
      }

      if (part.type === 'step-finish') {
        return []
      }

      return [{ id: `${message.id}-${part.id}`, type: 'part' as const, messageId: message.id, part }]
    })
  )
  const isSelectedSessionBusy = selectedSession?.status === 'busy' || selectedSession?.status === 'retry'

  useEffect(() => {
    ScriptAiReviewCoordinator.registerTarget({
      target,
      currentCode,
      onApply,
      defaultModel: appDefaultModel,
    })

    if (!reviewEntry?.workspaceState && !reviewEntry?.isLoading) {
      void ScriptAiReviewCoordinator.loadWorkspace(target, currentCode)
    }
  }, [appDefaultModel, currentCode, onApply, reviewEntry?.isLoading, reviewEntry?.workspaceState, target])

  useEffect(() => {
    const container = transcriptContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [selectedMessages])

  useEffect(() => {
    const textarea = promptRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [prompt])

  useEffect(() => {
    if (!selectedSessionId) {
      return
    }

    for (const message of selectedMessages) {
      if (!message.parts.some(part => part.type === 'patch')) {
        continue
      }

      const patchDiffKey = getPatchDiffKey(selectedSessionId, message.id)
      if (patchDiffsByMessageKey[patchDiffKey]) {
        continue
      }

      void ScriptAiReviewCoordinator.ensureMessagePatchDiff(target, selectedSessionId, message.id)
    }
  }, [patchDiffsByMessageKey, selectedMessages, selectedSessionId, target])

  async function createSession() {
    await ScriptAiReviewCoordinator.createSession(target)
  }

  async function sendPrompt() {
    setPromptHistoryIndex(null)
    setPromptHistoryDraft('')
    await ScriptAiReviewCoordinator.sendPrompt(target, buildScriptDocumentationPromptForTarget(target))
  }

  async function abortSelectedSession() {
    await ScriptAiReviewCoordinator.abortSelectedSession(target)
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'ArrowUp' && isCaretOnFirstLine(event.currentTarget)) {
      if (!promptHistory.length) {
        return
      }

      event.preventDefault()
      setPromptHistoryIndex(currentIndex => {
        const nextIndex = currentIndex === null ? promptHistory.length - 1 : Math.max(0, currentIndex - 1)
        if (currentIndex === null) {
          setPromptHistoryDraft(prompt)
        }
        scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: promptHistory[nextIndex] ?? '' })
        return nextIndex
      })
      return
    }

    if (event.key === 'ArrowDown' && promptHistoryIndex !== null && isCaretOnLastLine(event.currentTarget)) {
      event.preventDefault()
      setPromptHistoryIndex(currentIndex => {
        if (currentIndex === null) {
          return null
        }

        if (currentIndex >= promptHistory.length - 1) {
          scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: promptHistoryDraft })
          return null
        }

        const nextIndex = currentIndex + 1
        scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: promptHistory[nextIndex] ?? '' })
        return nextIndex
      })
      return
    }

    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()

    if (isSubmitting || !prompt.trim()) {
      return
    }

    void sendPrompt()
  }

  return (
    <Dialog
      title={`${documentation.title} AI Review`}
      onClose={() => dialogActions.close()}
      className="h-[90vh] max-h-[90vh] max-w-[1800px] overflow-hidden"
      bodyClassName="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-base-content/10 bg-base-100/70">
          <div ref={transcriptContainerRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
            {selectedSessionId ? (
              selectedMessages.length ? (
                <div className="space-y-2 text-xs">
                  {transcriptRows.map(row =>
                    row.type === 'divider' ? (
                      <div key={row.id} className="my-2 border-t border-base-content/10" />
                    ) : isApplyPatchToolPart(row.part) ? (
                      <ApplyPatchToolTranscriptPart key={row.id} part={row.part} />
                    ) : row.part.type === 'patch' && selectedSessionId ? (
                      <PatchTranscriptPart
                        key={row.id}
                        part={row.part}
                        patchDiffState={
                          patchDiffsByMessageKey[getPatchDiffKey(selectedSessionId, row.messageId)] ?? null
                        }
                      />
                    ) : (
                      <TranscriptPart key={row.id} part={row.part} />
                    )
                  )}
                </div>
              ) : (
                <div className="grid h-full place-items-center text-sm text-base-content/52">
                  No messages yet for this session.
                </div>
              )
            ) : isLoading ? (
              <div className="grid h-full place-items-center text-sm text-base-content/55">Loading sessions...</div>
            ) : (
              <div className="grid h-full place-items-center text-sm text-base-content/52">
                Select or create a session to see the transcript.
              </div>
            )}
          </div>
        </section>

        <div className="shrink-0 border-x border-b border-base-content/10">
          <div className="flex flex-wrap border-b border-base-content/10">
            <FlatButton
              className="min-w-0 flex-[0_0_auto] justify-between sm:min-w-[220px]"
              onClick={() => setIsSessionDialogOpen(true)}
              disabled={isLoading || isSubmitting}
            >
              <span className="truncate">{selectedSession?.title ?? 'Current Session Name'}</span>
              <ChevronDownIcon className="size-4 flex-shrink-0" />
            </FlatButton>
            <div className="flex min-h-12 min-w-0 flex-1 items-center border-l border-base-content/10 px-3 py-2 text-xs text-base-content/62 sm:flex-[0_1_auto] sm:whitespace-nowrap">
              {selectedSessionContextStats ? (
                <span className="truncate">{selectedSessionContextStats}</span>
              ) : (
                <span className="truncate text-base-content/38">No session context yet</span>
              )}
            </div>
            <FlatButton onClick={() => void createSession()} disabled={isLoading || isSubmitting}>
              <PlusIcon className="size-4" />
              New Session
            </FlatButton>
            <select
              className="min-h-12 w-full border-l border-base-content/10 bg-base-100 px-3 py-3 text-sm text-base-content outline-none sm:ml-auto sm:w-[260px]"
              value={selectedModel}
              onChange={event => ScriptAiReviewCoordinator.setSelectedModel(targetKey, event.target.value)}
              disabled={modelsLoading || isSubmitting}
            >
              <option value="">{appDefaultModel ? `App default (${appDefaultModel})` : 'OpenCode default'}</option>
              {openCodeModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <FlatButton onClick={() => setIsDiffDialogOpen(true)} disabled={isLoading}>
              Show diff
            </FlatButton>
            <FlatButton
              onClick={() => void (isSelectedSessionBusy ? abortSelectedSession() : sendPrompt())}
              disabled={isLoading || (isSelectedSessionBusy ? !selectedSessionId : isSubmitting || !prompt.trim())}
            >
              {isSelectedSessionBusy ? (
                <SquareIcon className="size-4" />
              ) : isSubmitting ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <SparklesIcon className="size-4" />
              )}
              {isSelectedSessionBusy ? 'Abort' : 'Send'}
            </FlatButton>
          </div>

          <textarea
            ref={promptRef}
            className="min-h-12 w-full resize-none border-0 bg-base-100 px-3 py-3 font-mono text-sm leading-6 text-base-content outline-none placeholder:text-base-content/40"
            placeholder={`Example: ${getPromptPlaceholder(primaryPhase)}`}
            value={prompt}
            onChange={event => {
              scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: event.target.value })
              setPromptHistoryIndex(null)
              setPromptHistoryDraft(event.target.value)
            }}
            onKeyDown={handlePromptKeyDown}
            rows={1}
          />

          {errorMessage || modelsLoading || modelsError ? (
            <div className="px-3 py-2 text-sm">
              {errorMessage ? <p className="text-error">{errorMessage}</p> : null}
              {!errorMessage && modelsLoading ? (
                <p className="text-base-content/55">Loading available models...</p>
              ) : null}
              {!errorMessage && !modelsLoading && modelsError ? <p className="text-error">{modelsError}</p> : null}
            </div>
          ) : null}
        </div>

        {isDiffDialogOpen ? (
          <Dialog
            title={`Current script vs workspace script (${workspaceState?.fileName ?? 'script'})`}
            onClose={() => setIsDiffDialogOpen(false)}
            className="max-w-[1600px]"
          >
            <div className="h-[75vh] min-h-[520px]">
              <ScriptAiMergeEditor
                originalValue={currentCode}
                modifiedValue={workspaceState?.workspaceCode ?? currentCode}
                language={editorLanguage}
                onModifiedChange={value => {
                  void ScriptAiReviewCoordinator.updateWorkspaceCode(target, value)
                }}
              />
            </div>
          </Dialog>
        ) : null}

        {isSessionDialogOpen ? (
          <Dialog title="Sessions" onClose={() => setIsSessionDialogOpen(false)} className="max-w-[720px]">
            <div className="flex min-h-[320px] flex-col border border-base-content/10 bg-base-100/70">
              {workspaceState?.sessions.length ? (
                <div className="divide-y divide-base-content/10">
                  {workspaceState.sessions.map(session => (
                    <button
                      key={session.id}
                      type="button"
                      className={[
                        'w-full px-4 py-3 text-left transition',
                        session.id === selectedSessionId ? 'bg-primary/8' : 'hover:bg-base-200/35',
                      ].join(' ')}
                      onClick={() => {
                        ScriptAiReviewCoordinator.selectSession(targetKey, session.id)
                        setIsSessionDialogOpen(false)
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-base-content">{session.title}</div>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-base-content/45">
                          {session.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-base-content/55">
                        {session.messageCount} message{session.messageCount === 1 ? '' : 's'}
                      </div>
                      {session.latestErrorMessage ? (
                        <div className="mt-2 text-xs text-error">{session.latestErrorMessage}</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid flex-1 place-items-center px-4 text-center text-sm text-base-content/52">
                  Start a new session to chat about this script.
                </div>
              )}
            </div>
          </Dialog>
        ) : null}
      </div>
    </Dialog>
  )
}

function FlatButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={[
        'flex min-h-12 items-center gap-2 border-l border-base-content/10 px-3 py-3 text-sm text-base-content transition first:border-l-0 disabled:cursor-not-allowed disabled:text-base-content/35',
        !disabled ? 'hover:bg-base-200/35' : '',
        className ?? '',
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function PatchTranscriptPart({
  part,
  patchDiffState,
}: {
  part: Extract<ScriptAiMessagePart, { type: 'patch' }>
  patchDiffState: {
    isLoading: boolean
    errorMessage: string | null
    diffs: ScriptAiMessagePatchDiff[] | null
  } | null
}) {
  const patchTitle = part.files.length === 1 ? 'Patch - 1 file' : `Patch - ${String(part.files.length)} files`
  const combinedPatch = patchDiffState?.diffs ? getCombinedPatchText(patchDiffState.diffs) : ''

  return (
    <div className="space-y-2 border border-base-content/8 bg-base-200/20 px-3 py-2 text-[12px]">
      <div className="font-medium text-base-content">{patchTitle}</div>
      {part.files.length ? (
        <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-base-content/55">
          {part.files.join('\n')}
        </div>
      ) : null}
      <div className="max-h-80 overflow-auto border border-base-content/8 bg-base-100/70 px-3 py-2">
        {patchDiffState?.isLoading ? (
          <div className="text-base-content/55">Loading patch...</div>
        ) : patchDiffState?.errorMessage ? (
          <div className="text-error">{patchDiffState.errorMessage}</div>
        ) : combinedPatch ? (
          <pre className="whitespace-pre-wrap break-words leading-5 text-base-content/70">{combinedPatch}</pre>
        ) : (
          <div className="text-base-content/55">No diff text available for this patch.</div>
        )}
      </div>
    </div>
  )
}

function ApplyPatchToolTranscriptPart({ part }: { part: Extract<ScriptAiMessagePart, { type: 'tool' }> }) {
  const patchText = getApplyPatchText(part.input)
  const operations = patchText ? parseApplyPatchOperations(patchText) : []

  if (operations.length) {
    return (
      <div className="space-y-3">
        {operations.map((operation, index) => (
          <ApplyPatchOperationView key={`${operation.path}-${String(index)}`} operation={operation} />
        ))}
      </div>
    )
  }

  if (!patchText) {
    return null
  }

  return (
    <div className="max-h-80 overflow-auto border border-base-content/8 bg-base-100/70 px-3 py-2">
      <pre className="whitespace-pre-wrap break-words leading-5 text-base-content/70">{patchText}</pre>
    </div>
  )
}

function ApplyPatchOperationView({ operation }: { operation: ParsedApplyPatchOperation }) {
  if (!operation.originalText && !operation.modifiedText) {
    return <div className="text-base-content/55">No line diff available.</div>
  }

  return (
    <div className="min-h-0 ">
      <ScriptAiMergeEditor
        originalValue={operation.originalText}
        modifiedValue={operation.modifiedText}
        language={getCodeEditorLanguageForPath(operation.path)}
        onModifiedChange={() => undefined}
        readOnlyModified
      />
    </div>
  )
}

function TranscriptPart({ part }: { part: ScriptAiMessagePart }) {
  return (
    <details className="bg-base-200/20 text-[12px]" open={false}>
      <summary
        className={clsx(
          'cursor-pointer list-none px-2 py-1 font-medium text-base-content',
          part.type !== 'text' && 'text-base-content/50'
        )}
      >
        {getTranscriptPartTitle(part)}
      </summary>
      <div className="border-t border-base-content/8 px-3 py-2">
        <pre className="whitespace-pre-wrap break-words leading-5 text-base-content/70">
          {getTranscriptPartContent(part)}
        </pre>
      </div>
    </details>
  )
}

function getTranscriptPartTitle(part: ScriptAiMessagePart) {
  switch (part.type) {
    case 'text':
      return getFirstLine(part.text) || 'Text'
    case 'reasoning':
      return getFirstLine(part.text) || 'Reasoning'
    case 'tool':
      return [part.title, part.toolName, part.status].filter(Boolean).join(' • ')
    case 'file':
      return part.path ?? part.filename ?? 'File attachment'
    case 'step-start':
      return ''
    case 'step-finish':
      return ''
    case 'snapshot':
      return 'Snapshot'
    case 'patch':
      return part.files.length === 1 ? 'Patch - 1 file' : `Patch - ${String(part.files.length)} files`
    case 'agent':
      return `Agent: ${part.name}`
    case 'subtask':
      return `Subtask: ${part.description}`
    case 'retry':
      return 'Retry'
    case 'compaction':
      return 'Compaction'
  }
}

function getTranscriptPartContent(part: ScriptAiMessagePart) {
  switch (part.type) {
    case 'text':
      return part.text
    case 'reasoning':
      return part.text
    case 'tool':
      return (
        [
          part.input ? `Input:\n${part.input}` : null,
          part.output ? `Output:\n${part.output}` : null,
          part.errorMessage ? `Error:\n${part.errorMessage}` : null,
        ]
          .filter(Boolean)
          .join('\n\n') || 'No details yet.'
      )
    case 'file':
      return part.path ?? part.filename ?? 'File attachment'
    case 'step-start':
      return 'Step started.'
    case 'step-finish':
      return 'Step finished.'
    case 'snapshot':
      return 'Snapshot created.'
    case 'patch':
      return part.files.join('\n') || 'Patch generated.'
    case 'agent':
      return part.name
    case 'subtask':
      return `${part.description}\n\n${part.prompt}`
    case 'retry':
      return 'Retry requested.'
    case 'compaction':
      return 'Compaction happened.'
  }
}

function getFirstLine(value: string) {
  return value.trim().split('\n')[0] ?? ''
}

function getCombinedPatchText(diffs: ScriptAiMessagePatchDiff[]) {
  return diffs
    .map(diff => {
      const heading = [diff.status, diff.file].filter(Boolean).join(' ')
      return [heading || null, diff.patch].filter(Boolean).join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

function isApplyPatchToolPart(part: ScriptAiMessagePart): part is Extract<ScriptAiMessagePart, { type: 'tool' }> {
  return part.type === 'tool' && part.toolName === 'apply_patch' && Boolean(getApplyPatchText(part.input))
}

function getApplyPatchText(input: string | null) {
  if (!input) {
    return null
  }

  try {
    const parsed = JSON.parse(input) as { patchText?: unknown }
    if (typeof parsed.patchText === 'string' && parsed.patchText.trim()) {
      return parsed.patchText
    }
  } catch {
    // Fall through to raw string parsing.
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
      continue
    }

    if (line.startsWith('-')) {
      currentOriginalLines.push(line.slice(1))
      continue
    }

    if (line.startsWith(' ')) {
      const value = line.slice(1)
      currentOriginalLines.push(value)
      currentModifiedLines.push(value)
      continue
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

function isCaretOnFirstLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(0, textarea.selectionStart).includes('\n')
}

function isCaretOnLastLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(textarea.selectionEnd).includes('\n')
}

function getSelectedSessionContextStats(
  session: ScriptAiSessionSummary | null,
  selectedModel: string,
  modelInfoById: Record<string, { contextWindow: number | null }>
) {
  if (!session) {
    return null
  }

  const totalTokens = session.tokens?.total ?? null
  const spent = session.spent
  const modelId = session.modelId ?? selectedModel
  const contextWindow = modelId ? (modelInfoById[modelId]?.contextWindow ?? null) : null
  const parts = [
    totalTokens !== null
      ? contextWindow
        ? `${formatCompactInteger(totalTokens)} / ${formatCompactInteger(contextWindow)} tokens`
        : `${formatCompactInteger(totalTokens)} tokens`
      : null,
    totalTokens !== null && contextWindow ? `${formatPercentage((totalTokens / contextWindow) * 100)} used` : null,
    spent !== null ? `${formatUsdAmount(spent)} spent` : null,
  ].filter(Boolean)

  return parts.join(' - ') || null
}

function formatCompactInteger(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value)
}

function formatPercentage(value: number) {
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: value >= 10 ? 0 : 1 }).format(value)}%`
}

function formatUsdAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1 ? 2 : 3,
    maximumFractionDigits: value >= 1 ? 2 : 3,
  }).format(value)
}

function getPromptPlaceholder(phase: ReturnType<typeof getPrimaryScriptAiPhase>) {
  switch (phase) {
    case 'pre-request':
      return 'Read a token from the active environment, set the Authorization header, and generate a trace id.'
    case 'post-request':
      return 'If the response is 401, call the refresh token request and save the returned token.'
    case 'response-visualizer':
      return 'Render the JSON body as cards grouped by status and show a raw payload editor underneath.'
    case 'view-runtime':
      return 'Build a small dashboard with a button that loads users via callRequest and renders them in a table.'
  }
}
