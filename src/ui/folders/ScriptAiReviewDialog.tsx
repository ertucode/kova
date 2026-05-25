import { errorResponseToMessage } from '@common/GenericError'
import { getScriptAiTargetKey, type ScriptAiMessagePart, type ScriptAiTarget, type ScriptAiPhase, type ScriptAiWorkspaceState } from '@common/ScriptAi'
import { LoaderCircleIcon, PlusIcon, SparklesIcon, SquareIcon } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { buildScriptDocumentationPrompt, scriptDocumentationByPhase } from './scriptDocumentation'
import { appSettingsStore } from '@/global/appSettingsStore'
import { useOpenCodeModels } from '@/global/useOpenCodeModels'
import { ScriptAiMergeEditor } from './ScriptAiMergeEditor'

type ScriptAiReviewDialogProps = {
  target: ScriptAiTarget
  currentCode: string
  onApply: (nextCode: string) => void
}

type TranscriptRow = {
  id: string
  type: 'divider'
} | {
  id: string
  type: 'part'
  part: ScriptAiMessagePart
}

export function openScriptAiReviewDialog(props: ScriptAiReviewDialogProps) {
  dialogActions.open({ component: ScriptAiReviewDialog, props })
}

export function ScriptAiReviewDialog({ target, currentCode, onApply }: ScriptAiReviewDialogProps) {
  const appDefaultModel = useSelector(appSettingsStore, state => state.context.settings?.scriptAiModel ?? null)
  const { models: openCodeModels, loading: modelsLoading, error: modelsError } = useOpenCodeModels()
  const [prompt, setPrompt] = useState('')
  const [proposal, setProposal] = useState(currentCode)
  const [workspaceState, setWorkspaceState] = useState<ScriptAiWorkspaceState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>(appDefaultModel ?? '')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)

  const documentation = scriptDocumentationByPhase[target.phase]
  const targetKey = getScriptAiTargetKey(target)
  const editorLanguage = target.phase === 'response-visualizer' || target.phase === 'view-runtime' ? 'jsx' : 'javascript'
  const selectedSession = workspaceState?.sessions.find(session => session.id === selectedSessionId) ?? null
  const selectedMessages = selectedSessionId ? (workspaceState?.messagesBySessionId[selectedSessionId] ?? []) : []
  const transcriptRows: TranscriptRow[] = selectedMessages.flatMap(message =>
    message.parts.flatMap<TranscriptRow>(part => {
      if (part.type === 'step-start') {
        return [{ id: `${message.id}-${part.id}-divider`, type: 'divider' as const }]
      }

      if (part.type === 'step-finish') {
        return []
      }

      return [{ id: `${message.id}-${part.id}`, type: 'part' as const, part }]
    })
  )
  const isSelectedSessionBusy = selectedSession?.status === 'busy' || selectedSession?.status === 'retry'

  useEffect(() => {
    let isCancelled = false

    void (async () => {
      setIsLoading(true)
      const result = await getWindowElectron().loadScriptAiWorkspace({ target, currentCode })

      if (isCancelled) {
        return
      }

      if (!result.success) {
        setErrorMessage(errorResponseToMessage(result.error))
        setIsLoading(false)
        return
      }

      applyWorkspaceState(result.data)
      setIsLoading(false)
    })()

    const unsubscribe = getWindowElectron().onGenericEvent(event => {
      if (event.type !== 'script-ai-state-updated' || event.state.targetKey !== targetKey) {
        return
      }

      applyWorkspaceState(event.state)
    })

    return () => {
      isCancelled = true
      unsubscribe()
    }
  }, [currentCode, target, targetKey])

  useEffect(() => {
    const container = transcriptContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [selectedMessages])

  function applyWorkspaceState(nextState: ScriptAiWorkspaceState) {
    setWorkspaceState(nextState)
    setProposal(nextState.workspaceCode)
    setSelectedSessionId(currentSessionId => {
      if (currentSessionId && nextState.sessions.some(session => session.id === currentSessionId)) {
        return currentSessionId
      }

      return nextState.activeSessionId ?? nextState.sessions[0]?.id ?? null
    })
  }

  async function createSessionRequest() {
    const result = await getWindowElectron().createScriptAiSession({
      target,
      currentCode,
      model: selectedModel || null,
    })

    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return null
    }

    applyWorkspaceState(result.data)
    setSelectedSessionId(result.data.activeSessionId)
    return result.data.activeSessionId
  }

  async function createSession() {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await createSessionRequest()
    } finally {
      setIsSubmitting(false)
    }
  }

  async function sendPrompt() {
    if (!prompt.trim()) {
      setErrorMessage('Describe what you want the script to do first.')
      return
    }

    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      const ensuredSessionId = selectedSessionId ?? (await createSessionRequest())
      if (!ensuredSessionId) {
        return
      }

      const result = await getWindowElectron().sendScriptAiMessage({
        target,
        currentCode,
        sessionId: ensuredSessionId,
        message: prompt.trim(),
        model: selectedModel || null,
        documentation: buildScriptDocumentationPrompt(target.phase),
      })

      if (!result.success) {
        setErrorMessage(errorResponseToMessage(result.error))
        return
      }

      applyWorkspaceState(result.data)
      setPrompt('')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function abortSelectedSession() {
    if (!selectedSessionId) {
      return
    }

    const result = await getWindowElectron().abortScriptAiSession({ target, sessionId: selectedSessionId })
    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    applyWorkspaceState(result.data)
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()

    if (isSubmitting || !prompt.trim()) {
      return
    }

    void sendPrompt()
  }

  async function applyProposal() {
    const result = await getWindowElectron().applyScriptAiWorkspace({ target, code: proposal })
    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    onApply(result.data.code)
    dialogActions.close()
    toast.show({ severity: 'success', message: 'AI suggestion applied to the script.' })
  }

  return (
    <Dialog
      title={`${documentation.title} AI Review`}
      onClose={() => dialogActions.close()}
      className="max-w-[1800px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void applyProposal()} disabled={isLoading || isSubmitting}>
            Apply
          </button>
        </>
      }
    >
      <div className="flex max-h-[90vh] min-h-[820px] flex-col gap-4">
        <section className="rounded-2xl border border-base-content/10 bg-base-100/70 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-base-content">Chat</div>
              <p className="mt-1 text-sm leading-6 text-base-content/68">
                Talk to OpenCode, keep separate sessions for this script target, and review the live file changes below.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => void createSession()} disabled={isLoading || isSubmitting}>
                <PlusIcon className="size-4" />
                New session
              </button>
              {selectedSessionId ? (
                <button type="button" className="btn btn-ghost" onClick={() => void abortSelectedSession()} disabled={!isSelectedSessionBusy}>
                  <SquareIcon className="size-4" />
                  Abort
                </button>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={() => void sendPrompt()} disabled={isLoading || isSubmitting || !prompt.trim()}>
                {isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                Send
              </button>
            </div>
          </div>

          <textarea
            className="textarea min-h-24 w-full rounded-xl border-base-content/10 bg-base-100 font-mono text-sm leading-6"
            placeholder={`Example: ${getPromptPlaceholder(target.phase)}`}
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
          />

          <label className="mt-3 block max-w-[420px]">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Model</div>
            <select
              className="select h-11 w-full rounded-xl border-base-content/10 bg-base-100"
              value={selectedModel}
              onChange={event => setSelectedModel(event.target.value)}
              disabled={modelsLoading || isSubmitting}
            >
              <option value="">{appDefaultModel ? `App default (${appDefaultModel})` : 'OpenCode default'}</option>
              {openCodeModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            {modelsLoading ? <p className="mt-2 text-sm text-base-content/55">Loading available models...</p> : null}
            {modelsError ? <p className="mt-2 text-sm text-error">{modelsError}</p> : null}
          </label>

          {errorMessage ? <p className="mt-3 text-sm text-error">{errorMessage}</p> : null}
        </section>

        <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
            <div className="border-b border-base-content/10 px-4 py-3 text-sm font-medium text-base-content">Sessions</div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {isLoading ? (
                <div className="grid h-full place-items-center text-sm text-base-content/55">Loading sessions...</div>
              ) : workspaceState?.sessions.length ? (
                <div className="space-y-2">
                  {workspaceState.sessions.map(session => (
                    <button
                      key={session.id}
                      type="button"
                      className={[
                        'w-full rounded-xl border px-3 py-3 text-left transition',
                        session.id === selectedSessionId
                          ? 'border-primary/30 bg-primary/8'
                          : 'border-base-content/10 bg-base-100/60 hover:border-base-content/20 hover:bg-base-100',
                      ].join(' ')}
                      onClick={() => setSelectedSessionId(session.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-medium text-base-content">{session.title}</div>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-base-content/45">{session.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-base-content/55">
                        {session.messageCount} message{session.messageCount === 1 ? '' : 's'}
                      </p>
                      {session.latestErrorMessage ? <p className="mt-2 text-xs text-error">{session.latestErrorMessage}</p> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-base-content/12 px-4 text-center text-sm text-base-content/52">
                  Start a new session to chat about this script.
                </div>
              )}
            </div>
          </div>

          <div className="grid min-h-0 gap-4 xl:grid-rows-[minmax(0,0.6fr)_minmax(0,1.6fr)]">
            <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
              <div className="border-b border-base-content/10 px-4 py-3 text-sm font-medium text-base-content">Transcript</div>
              <div ref={transcriptContainerRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
                {selectedSessionId ? (
                  selectedMessages.length ? (
                    <div className="space-y-2 text-xs">
                      {transcriptRows.map(row => (
                        row.type === 'divider' ? <div key={row.id} className="my-2 border-t border-base-content/10" /> : <TranscriptPart key={row.id} part={row.part} />
                      ))}
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center text-sm text-base-content/52">No messages yet for this session.</div>
                  )
                ) : (
                  <div className="grid h-full place-items-center text-sm text-base-content/52">Select or create a session to see the transcript.</div>
                )}
              </div>
            </div>

            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
              <div className="border-b border-base-content/10 px-4 py-3 text-sm font-medium text-base-content">
                Current script vs workspace script ({workspaceState?.fileName ?? 'script'})
              </div>
              <div className="min-h-0 flex-1 p-3">
                <ScriptAiMergeEditor originalValue={currentCode} modifiedValue={proposal} language={editorLanguage} onModifiedChange={setProposal} />
              </div>
            </section>
          </div>
        </section>
      </div>
    </Dialog>
  )
}

function TranscriptPart({ part }: { part: ScriptAiMessagePart }) {
  return (
    <details className="rounded-xl border border-base-content/10 bg-base-200/20 text-[11px]" open={false}>
      <summary className="cursor-pointer list-none px-3 py-2 font-medium text-base-content/75">
        {getTranscriptPartTitle(part)}
      </summary>
      <div className="border-t border-base-content/8 px-3 py-2">
        <pre className="whitespace-pre-wrap break-words leading-5 text-base-content/70">{getTranscriptPartContent(part)}</pre>
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
      return 'Patch'
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
      return [part.input ? `Input:\n${part.input}` : null, part.output ? `Output:\n${part.output}` : null, part.errorMessage ? `Error:\n${part.errorMessage}` : null]
        .filter(Boolean)
        .join('\n\n') || 'No details yet.'
    case 'file':
      return part.path ?? part.filename ?? 'File attachment'
    case 'step-start':
      return 'Step started.'
    case 'step-finish':
      return 'Step finished.'
    case 'snapshot':
      return 'Snapshot created.'
    case 'patch':
      return 'Patch generated.'
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

function getPromptPlaceholder(phase: ScriptAiPhase) {
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
