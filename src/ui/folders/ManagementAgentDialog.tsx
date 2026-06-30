import { LoaderCircleIcon, PlusIcon, SparklesIcon, SquareIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useSelector } from '@xstate/store/react'
import { errorResponseToMessage } from '@common/GenericError'
import type {
  ManagementAgentItemTagUpdatePlanItem,
  ManagementAgentMessagePart,
  ManagementAgentPlanRecord,
  ManagementAgentRequestCreatePlanItem,
  ManagementAgentRequestUpdatePlanItem,
  ManagementAgentScope,
  ManagementAgentTagItemUpdatePlanItem,
  ManagementAgentWorkspaceState,
} from '@common/ManagementAgent'
import type { ExplorerItem } from '@common/Explorer'
import type { TagRecord } from '@common/Tags'
import { Typescript } from '@common/Typescript'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { getWindowElectron } from '@/getWindowElectron'
import { useOpenCodeModels } from '@/global/useOpenCodeModels'
import { ChangesCoordinator } from './changesCoordinator'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { TagsCoordinator } from './tagsCoordinator'
import { tagsStore } from './tagsStore'

type ManagementAgentDialogProps = {
  scope: ManagementAgentScope
}

const EMPTY_PROMPT_HISTORY: string[] = []

export function openManagementAgentDialog(scope: ManagementAgentScope) {
  dialogActions.open({ component: ManagementAgentDialog, props: { scope } })
}

export function ManagementAgentDialog({ scope }: ManagementAgentDialogProps) {
  const { models: openCodeModels, loading: modelsLoading, error: modelsError } = useOpenCodeModels()
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const tagItems = useSelector(tagsStore, state => state.context.items)
  const [workspaceState, setWorkspaceState] = useState<ManagementAgentWorkspaceState | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(readSelectedSessionId(scope))
  const [selectedModel, setSelectedModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [promptHistory, setPromptHistory] = useState<string[]>(EMPTY_PROMPT_HISTORY)
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(null)
  const [promptHistoryDraft, setPromptHistoryDraft] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  const sessions = workspaceState?.sessions ?? []
  const selectedSessionState = sessions.find(sessionState => sessionState.session.id === selectedSessionId) ?? sessions[0] ?? null
  const selectedSession = selectedSessionState?.session ?? null
  const visiblePlan = selectedSessionState?.activePlan ?? selectedSessionState?.appliedPlans[0] ?? null
  const isSelectedSessionBusy = selectedSession?.status === 'busy'
  const canApply = Boolean(
    selectedSessionState?.activePlan &&
      selectedSessionState.activePlan.plan.questions.length === 0 &&
      !isSelectedSessionBusy &&
      !isSubmitting
  )

  useEffect(() => {
    void loadWorkspace()
  }, [scope.scopeType, scope.targetFolderId, scope.targetRequestId])

  useEffect(() => {
    return getWindowElectron().onGenericEvent(event => {
      if (event.type !== 'management-agent-state-updated') {
        return
      }

      if (!isSameManagementScope(event.state, scope)) {
        return
      }

      applyWorkspaceState(event.state)
    })
  }, [scope.scopeType, scope.targetFolderId, scope.targetRequestId])

  useEffect(() => {
    const container = transcriptContainerRef.current
    if (!container) {
      return
    }

    container.scrollTop = container.scrollHeight
  }, [selectedSessionState?.messages])

  useEffect(() => {
    const textarea = promptRef.current
    if (!textarea) {
      return
    }

    textarea.style.height = '0px'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [prompt])

  useEffect(() => {
    const nextSelectedModel = selectedSession?.selectedModel ?? ''
    setSelectedModel(current => (current === nextSelectedModel ? current : nextSelectedModel))
  }, [selectedSession?.selectedModel])

  function applyWorkspaceState(nextState: ManagementAgentWorkspaceState, options?: { selectedSessionId?: string | null }) {
    setWorkspaceState(nextState)
    setSelectedSessionId(currentSelectedSessionId => {
      const requestedSelectedSessionId = options?.selectedSessionId
      const nextSelected = requestedSelectedSessionId !== undefined
        ? requestedSelectedSessionId
        : currentSelectedSessionId && nextState.sessions.some(sessionState => sessionState.session.id === currentSelectedSessionId)
        ? currentSelectedSessionId
        : nextState.sessions[0]?.session.id ?? null
      writeSelectedSessionId(scope, nextSelected)
      return nextSelected
    })
    setIsLoading(false)
    setIsSubmitting(false)
  }

  async function loadWorkspace() {
    setIsLoading(true)
    setErrorMessage(null)
    const result = await getWindowElectron().loadManagementAgentWorkspace(scope)
    if (!result.success) {
      setIsLoading(false)
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    applyWorkspaceState(result.data)
  }

  async function createSession() {
    setErrorMessage(null)
    setIsSubmitting(true)
    const existingSessionIds = new Set((workspaceState?.sessions ?? []).map(sessionState => sessionState.session.id))
    const result = await getWindowElectron().createManagementAgentSession({ ...scope, model: selectedModel || null })
    if (!result.success) {
      setIsSubmitting(false)
      setErrorMessage(errorResponseToMessage(result.error))
      return null
    }

    const createdSessionId =
      result.data.sessions.find(sessionState => !existingSessionIds.has(sessionState.session.id))?.session.id
      ?? result.data.sessions[0]?.session.id
      ?? null

    setPrompt('')
    setPromptHistory([])
    applyWorkspaceState(result.data, { selectedSessionId: createdSessionId })
    return createdSessionId
  }

  async function sendPrompt() {
    const nextSessionId = selectedSession ? selectedSession.id : await createSession()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || !nextSessionId) {
      return
    }

    setPrompt('')
    setPromptHistory(currentHistory => [...currentHistory, trimmedPrompt])
    setPromptHistoryIndex(null)
    setPromptHistoryDraft('')
    setErrorMessage(null)
    setIsSubmitting(true)

    const result = await getWindowElectron().sendManagementAgentMessage({
      sessionId: nextSessionId,
      message: trimmedPrompt,
      model: selectedModel || null,
    })

    if (!result.success) {
      setIsSubmitting(false)
      setPrompt(trimmedPrompt)
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    applyWorkspaceState(result.data)
  }

  async function abortSelectedSession() {
    if (!selectedSessionId) {
      return
    }

    setErrorMessage(null)
    const result = await getWindowElectron().abortManagementAgentSession({ sessionId: selectedSessionId })
    if (!result.success) {
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    applyWorkspaceState(result.data)
  }

  async function applyDraft() {
    if (!selectedSessionId || !canApply) {
      return
    }

    setErrorMessage(null)
    setIsSubmitting(true)
    const result = await getWindowElectron().applyManagementAgentPlan({ sessionId: selectedSessionId })
    if (!result.success) {
      setIsSubmitting(false)
      setErrorMessage(errorResponseToMessage(result.error))
      return
    }

    applyWorkspaceState(result.data)
    await Promise.all([
      FolderExplorerCoordinator.loadItems(),
      EnvironmentCoordinator.loadEnvironments(),
      TagsCoordinator.loadTags(),
      ChangesCoordinator.loadOperations(),
    ])
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
        setPrompt(promptHistory[nextIndex] ?? '')
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
          setPrompt(promptHistoryDraft)
          return null
        }

        const nextIndex = currentIndex + 1
        setPrompt(promptHistory[nextIndex] ?? '')
        return nextIndex
      })
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (isSelectedSessionBusy) {
        void abortSelectedSession()
        return
      }

      if (!isSubmitting && prompt.trim()) {
        void sendPrompt()
      }
    }
  }

  return (
    <Dialog
      title={getManagementAgentDialogTitle(scope)}
      onClose={() => dialogActions.close()}
      className="h-[90vh] max-h-[90vh] max-w-[1800px] overflow-hidden"
      bodyClassName="overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 overflow-hidden border border-base-content/10 bg-base-100/70">
          <section className="min-h-0 min-w-0 flex-1 border-r border-base-content/10">
            <div ref={transcriptContainerRef} className="h-full overflow-auto px-4 py-3">
              {selectedSessionState ? (
                selectedSessionState.messages.length ? (
                  <div className="space-y-2 text-xs">
                    {selectedSessionState.messages.flatMap(message =>
                      message.parts.map(part => <TranscriptPart key={`${message.id}-${part.id}`} part={part} />)
                    )}
                  </div>
                ) : (
                  <EmptyPanel message="No messages yet for this session." />
                )
              ) : isLoading ? (
                <EmptyPanel message="Loading management sessions..." />
              ) : (
                <EmptyPanel message="Create a session to start managing this workspace with AI." />
              )}
            </div>
          </section>

          <aside className="flex w-[420px] min-w-[360px] flex-col overflow-hidden bg-base-100/55">
            <div className="border-b border-base-content/10 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/50">Draft Changes</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              {visiblePlan ? <PlanView planRecord={visiblePlan} explorerItems={explorerItems} tagItems={tagItems} /> : <EmptyPanel message="No draft plan yet." />}
            </div>
          </aside>
        </div>

        <div className="shrink-0 border-x border-b border-base-content/10 bg-base-100">
          <div className="flex flex-wrap items-center gap-2 border-b border-base-content/10 px-3 py-2">
            <select
              className="min-h-10 min-w-[220px] flex-1 bg-base-100 text-sm outline-none sm:flex-none"
              value={selectedSessionId ?? ''}
              onChange={event => {
                const nextSessionId = event.target.value || null
                setSelectedSessionId(nextSessionId)
                writeSelectedSessionId(scope, nextSessionId)
              }}
              disabled={isLoading || isSubmitting}
            >
              {!sessions.length ? <option value="">No sessions</option> : null}
              {sessions.map(sessionState => (
                <option key={sessionState.session.id} value={sessionState.session.id}>
                  {sessionState.session.title} - {sessionState.session.status} - {sessionState.messages.length} msgs
                </option>
              ))}
            </select>

            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void createSession()} disabled={isLoading || isSubmitting}>
              <PlusIcon className="size-4" />
              New Session
            </button>

            <select
              className="min-h-10 min-w-[240px] bg-base-100 text-sm outline-none"
              value={selectedModel}
              onChange={event => setSelectedModel(event.target.value)}
              disabled={modelsLoading || isSubmitting}
            >
              <option value="">OpenCode default</option>
              {openCodeModels.map(model => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              onClick={() => void (isSelectedSessionBusy ? abortSelectedSession() : sendPrompt())}
              disabled={isLoading || (isSelectedSessionBusy ? !selectedSessionId : isSubmitting || !prompt.trim())}
            >
              {isSelectedSessionBusy ? <SquareIcon className="size-4" /> : isSubmitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
              {isSelectedSessionBusy ? 'Abort' : 'Send'}
            </button>

            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void applyDraft()} disabled={!canApply}>
              Apply
            </button>
          </div>

          <textarea
            ref={promptRef}
            className="min-h-12 w-full resize-none border-0 bg-base-100 px-3 py-3 font-mono text-sm leading-6 text-base-content outline-none placeholder:text-base-content/40"
              placeholder="Describe what you want to organize, update, or create in Kova."
            value={prompt}
            onChange={event => {
              setPrompt(event.target.value)
              setPromptHistoryIndex(null)
              setPromptHistoryDraft(event.target.value)
            }}
            onKeyDown={handlePromptKeyDown}
            rows={1}
          />

          {errorMessage || modelsLoading || modelsError ? (
            <div className="px-3 py-2 text-sm">
              {errorMessage ? <p className="text-error">{errorMessage}</p> : null}
              {!errorMessage && modelsLoading ? <p className="text-base-content/55">Loading available models...</p> : null}
              {!errorMessage && !modelsLoading && modelsError ? <p className="text-error">{modelsError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  )
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="grid h-full min-h-[180px] place-items-center text-center text-sm text-base-content/52">{message}</div>
}

function PlanView({
  planRecord,
  explorerItems,
  tagItems,
}: {
  planRecord: ManagementAgentPlanRecord
  explorerItems: ExplorerItem[]
  tagItems: TagRecord[]
}) {
  const plan = planRecord.plan
  const explorerItemMap = useMemo(
    () => new Map(explorerItems.map(item => [`${item.itemType}:${item.id}`, item] as const)),
    [explorerItems]
  )
  const tagMap = useMemo(() => new Map(tagItems.map(tag => [tag.id, tag] as const)), [tagItems])
  const sections = [
    plan.questions.length > 0
      ? <PlanList key="questions" title="Questions" items={plan.questions.map(question => `${question.label}${question.details ? `\n${question.details}` : ''}`)} tone="error" />
      : null,
    plan.warnings.length > 0
      ? <PlanList key="warnings" title="Warnings" items={plan.warnings.map(warning => warning.message)} tone="warning" />
      : null,
    plan.foldersToCreate.length > 0
      ? <PlanList key="folders" title="Folders to Create" items={plan.foldersToCreate.map(folder => `${folder.name}\n${formatPlannedParent(folder.parentFolderId, folder.parentScope, explorerItemMap)}`)} />
      : null,
    plan.foldersToUpdate.length > 0
      ? <FolderUpdateSection key="folders-update" title="Folders to Update" folders={plan.foldersToUpdate} explorerItemMap={explorerItemMap} />
      : null,
    plan.requestsToCreate.length > 0
      ? <RequestPlanSection key="requests-create" title="Requests to Create" requests={plan.requestsToCreate} explorerItemMap={explorerItemMap} />
      : null,
    plan.requestsToUpdate.length > 0
      ? <RequestPlanSection key="requests-update" title="Requests to Update" requests={plan.requestsToUpdate} explorerItemMap={explorerItemMap} />
      : null,
    plan.requestsToDelete.length > 0
      ? <PlanList key="requests-delete" title="Requests to Delete" items={plan.requestsToDelete.map(request => formatDeletionTarget(explorerItemMap, 'request', request.requestId))} />
      : null,
    plan.foldersToDelete.length > 0
      ? <PlanList key="folders-delete" title="Folders to Delete" items={plan.foldersToDelete.map(folder => formatDeletionTarget(explorerItemMap, 'folder', folder.folderId))} />
      : null,
    plan.environmentUpdates.length > 0
      ? <EnvironmentUpdateSection key="environments" title="Environment Updates" updates={plan.environmentUpdates} />
      : null,
    plan.tagsToCreate.length > 0
      ? <PlanList key="tags-create" title="Tags to Create" items={plan.tagsToCreate.map(tag => formatTagSummary(tag.name, tag.color))} />
      : null,
    plan.tagsToUpdate.length > 0
      ? <TagUpdateSection key="tags-update" title="Tags to Update" tags={plan.tagsToUpdate} tagMap={tagMap} />
      : null,
    plan.itemTagUpdates.length > 0
      ? <PlanList key="item-tags" title="Item Tag Updates" items={plan.itemTagUpdates.map(update => formatItemTagUpdate(update, explorerItemMap, tagMap))} />
      : null,
    plan.tagItemUpdates.length > 0
      ? <PlanList key="tag-items" title="Tag Item Updates" items={plan.tagItemUpdates.map(update => formatTagItemUpdate(update, explorerItemMap, tagMap))} />
      : null,
  ].filter(section => section !== null)

  const summary = plan.summary.trim()

  return (
    <div className="space-y-4 text-sm">
      {summary ? (
        <section className="rounded-xl border border-base-content/10 bg-base-100/70 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">Summary</div>
            {planRecord.kind === 'applied' ? <span className="badge badge-success badge-sm">Applied</span> : <span className="badge badge-ghost badge-sm">Draft</span>}
          </div>
          <div className="mt-2 whitespace-pre-wrap text-base-content/75">{summary}</div>
        </section>
      ) : null}

      {sections.length > 0 ? sections : <EmptyPanel message="No planned changes yet." />}
    </div>
  )
}

function RequestPlanSection({
  title,
  requests,
  explorerItemMap,
}: {
  title: string
  requests: Array<ManagementAgentRequestCreatePlanItem | ManagementAgentRequestUpdatePlanItem>
  explorerItemMap: Map<string, ExplorerItem>
}) {
  return (
    <section className="rounded-xl border border-base-content/10 bg-base-100/70 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-3 space-y-3">
        {requests.map(request => (
          <RequestPlanCard key={'requestId' in request ? request.requestId : request.id} request={request} explorerItemMap={explorerItemMap} />
        ))}
      </div>
    </section>
  )
}

function FolderUpdateSection({
  title,
  folders,
  explorerItemMap,
}: {
  title: string
  folders: ManagementAgentPlanRecord['plan']['foldersToUpdate']
  explorerItemMap: Map<string, ExplorerItem>
}) {
  return (
    <section className="rounded-xl border border-base-content/10 bg-base-100/70 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-3 space-y-3">
        {folders.map(folder => (
          <div key={folder.folderId} className="rounded-xl border border-base-content/10 bg-base-100/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/45">Folder update</div>
            <div className="mt-1 text-sm font-medium text-base-content">{getExplorerItemLabel(explorerItemMap, 'folder', folder.folderId)}</div>
            <FieldBlock label="Name" value={folder.name} />
            <FieldBlock label="Description" value={folder.description} />
            <FieldBlock label="Headers" value={folder.headers} emptyValue="No headers." code />
            <FieldBlock label="Pre-request Script" value={folder.preRequestScript} code />
            <FieldBlock label="Post-request Script" value={folder.postRequestScript} code />
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-base-content/68">
              <InlineMeta label="Auth" value={getAuthSummary(folder.auth)} />
              <InlineMeta label="Selection" value={folder.runConfig.selectionMode} />
              <InlineMeta label="Execution" value={folder.runConfig.executionMode} />
              <InlineMeta label="Continue On Failure" value={folder.runConfig.continueOnFailure ? 'yes' : 'no'} />
            </div>
            {folder.runConfig.selectedRequestIds.length > 0 ? <FieldBlock label="Selected Requests" value={folder.runConfig.selectedRequestIds.join('\n')} code /> : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function EnvironmentUpdateSection({ title, updates }: { title: string; updates: ManagementAgentPlanRecord['plan']['environmentUpdates'] }) {
  return (
    <section className="rounded-xl border border-base-content/10 bg-base-100/70 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-3 space-y-3">
        {updates.map(update => (
          <div key={update.environmentId} className="rounded-xl border border-base-content/10 bg-base-100/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/45">Environment update</div>
            <div className="mt-1 text-sm font-medium text-base-content">{update.environmentName || update.environmentId}</div>
            <FieldBlock label="Variables" value={update.variables.map(variable => `${variable.key}=${variable.value}`).join('\n')} code />
          </div>
        ))}
      </div>
    </section>
  )
}

function TagUpdateSection({
  title,
  tags,
  tagMap,
}: {
  title: string
  tags: ManagementAgentPlanRecord['plan']['tagsToUpdate']
  tagMap: Map<string, TagRecord>
}) {
  return (
    <section className="rounded-xl border border-base-content/10 bg-base-100/70 p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-3 space-y-3">
        {tags.map(tag => (
          <div key={tag.tagId} className="rounded-xl border border-base-content/10 bg-base-100/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/45">Tag update</div>
            <div className="mt-1 text-sm font-medium text-base-content">{getTagLabel(tagMap, tag.tagId)}</div>
            <FieldBlock label="Name" value={tag.name} />
            <InlineMeta label="Color" value={tag.color ?? 'none'} />
          </div>
        ))}
      </div>
    </section>
  )
}

function RequestPlanCard({
  request,
  explorerItemMap,
}: {
  request: ManagementAgentRequestCreatePlanItem | ManagementAgentRequestUpdatePlanItem
  explorerItemMap: Map<string, ExplorerItem>
}) {
  const isRequestUpdate = 'requestId' in request
  const authSummary = getRequestAuthSummary(request)
  const requestLabel = isRequestUpdate ? getExplorerItemLabel(explorerItemMap, 'request', request.requestId) : request.name || 'Untitled Request'
  const metaItems = [
    !isRequestUpdate || 'method' in request ? { label: 'Method', value: request.method ?? 'GET' } : null,
    !isRequestUpdate || authSummary ? { label: 'Auth', value: authSummary ?? 'inherit' } : null,
    !isRequestUpdate || 'bodyType' in request ? { label: 'Body Type', value: request.bodyType ?? 'none' } : null,
    !isRequestUpdate || 'rawType' in request ? { label: 'Raw Type', value: request.rawType ?? 'json' } : null,
    !isRequestUpdate || 'preferredResponseBodyView' in request ? { label: 'Response View', value: request.preferredResponseBodyView ?? 'raw' } : null,
    !isRequestUpdate || 'saveToHistory' in request ? { label: 'Save History', value: request.saveToHistory ? 'yes' : 'no' } : null,
  ].filter(item => item !== null)

  return (
    <div className="rounded-xl border border-base-content/10 bg-base-100/80 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/45">{isRequestUpdate ? 'Request update' : request.method}</div>
          <div className="mt-1 text-sm font-medium text-base-content">{requestLabel}</div>
        </div>
        {!isRequestUpdate ? <div className="text-right text-[11px] text-base-content/45">{request.bodyType} body</div> : null}
      </div>

      {!isRequestUpdate || 'name' in request ? <FieldBlock label="Name" value={request.name ?? ''} /> : null}
      {!isRequestUpdate || 'url' in request ? <FieldBlock label="URL" value={request.url ?? ''} /> : null}
      {!isRequestUpdate || 'headers' in request ? <FieldBlock label="Headers" value={request.headers ?? ''} emptyValue="No headers." code /> : null}
      {!isRequestUpdate || hasRequestBodyPreview(request) ? <FieldBlock label="Body" value={getRequestBodyPreview(request)} emptyValue="No body." code /> : null}
      {!isRequestUpdate || 'preRequestScript' in request ? <FieldBlock label="Pre-request Script" value={request.preRequestScript ?? ''} code /> : null}
      {!isRequestUpdate || 'postRequestScript' in request ? <FieldBlock label="Post-request Script" value={request.postRequestScript ?? ''} code /> : null}
      {!isRequestUpdate || 'testScript' in request ? <FieldBlock label="Test Script" value={request.testScript ?? ''} code /> : null}
      {!isRequestUpdate || 'responseVisualizer' in request ? <FieldBlock label="Response Visualizer" value={request.responseVisualizer ?? ''} code /> : null}
      {!isRequestUpdate || 'responseTableAccessor' in request ? <FieldBlock label="Response Table Accessor" value={request.responseTableAccessor ?? ''} code /> : null}

      {metaItems.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-base-content/68">
          {metaItems.map(item => (
            <InlineMeta key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      ) : null}

      {!isRequestUpdate || request.searchParams?.trim() ? <FieldBlock label="Search Params" value={request.searchParams ?? ''} code /> : null}
      {!isRequestUpdate || request.pathParams?.trim() ? <FieldBlock label="Path Params" value={request.pathParams ?? ''} code /> : null}
      {!isRequestUpdate || request.graphqlQuery?.trim() ? <FieldBlock label="GraphQL Query" value={request.graphqlQuery ?? ''} code /> : null}
      {!isRequestUpdate || request.graphqlVariables?.trim() ? <FieldBlock label="GraphQL Variables" value={request.graphqlVariables ?? ''} code /> : null}
    </div>
  )
}

function FieldBlock({
  label,
  value,
  emptyValue = 'Empty.',
  code = false,
}: {
  label: string
  value: string
  emptyValue?: string
  code?: boolean
}) {
  const trimmedValue = value.trim()

  return (
    <div className="mt-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-base-content/45">{label}</div>
      {trimmedValue ? (
        code ? (
          <pre className="mt-1 overflow-auto rounded-lg border border-base-content/8 bg-base-200/30 px-2 py-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-base-content/78">{trimmedValue}</pre>
        ) : (
          <div className="mt-1 break-words text-[13px] leading-5 text-base-content/78">{trimmedValue}</div>
        )
      ) : (
        <div className="mt-1 text-[12px] text-base-content/50">{emptyValue}</div>
      )}
    </div>
  )
}

function InlineMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-base-content/8 bg-base-200/20 px-2 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-content/42">{label}</div>
      <div className="mt-1 break-words text-[12px] text-base-content/78">{value}</div>
    </div>
  )
}

function getRequestBodyPreview(request: ManagementAgentRequestCreatePlanItem | ManagementAgentRequestUpdatePlanItem) {
  if (request.bodyType === 'graphql' || ('requestId' in request && ('graphqlQuery' in request || 'graphqlVariables' in request))) {
    return [request.graphqlQuery?.trim() ? `Query:\n${request.graphqlQuery}` : null, request.graphqlVariables?.trim() ? `Variables:\n${request.graphqlVariables}` : null]
      .filter(Boolean)
      .join('\n\n')
  }

  return request.body ?? ''
}

function getRequestAuthSummary(request: ManagementAgentRequestCreatePlanItem | ManagementAgentRequestUpdatePlanItem) {
  if (!request.auth) {
    return null
  }

  return getAuthSummary(request.auth)
}

function getAuthSummary(auth: NonNullable<ManagementAgentRequestCreatePlanItem['auth']>) {
  switch (auth.type) {
    case 'inherit':
      return 'inherit'
    case 'noauth':
      return 'none'
    case 'bearer':
      return auth.token.trim() ? 'bearer token set' : 'bearer token empty'
    case 'apikey':
      return auth.key.trim() ? `api key via ${auth.addTo}` : 'api key incomplete'
    case 'basic':
      return auth.username.trim() || auth.password.trim() ? 'basic auth set' : 'basic auth empty'
    default:
      return Typescript.assertUnreachable(auth)
  }
}

function hasRequestBodyPreview(request: ManagementAgentRequestCreatePlanItem | ManagementAgentRequestUpdatePlanItem) {
  if (!('requestId' in request)) {
    return true
  }

  return 'body' in request || 'bodyType' in request || 'graphqlQuery' in request || 'graphqlVariables' in request
}

function PlanList({ title, items, tone = 'default' }: { title: string; items: string[]; tone?: 'default' | 'warning' | 'error' }) {
  const toneClassName = tone === 'error' ? 'border-error/20 bg-error/5' : tone === 'warning' ? 'border-warning/20 bg-warning/5' : 'border-base-content/10 bg-base-100/70'

  return (
    <section className={`rounded-xl border p-3 ${toneClassName}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-2 space-y-2">
        {items.map(item => (
          <pre key={item} className="whitespace-pre-wrap break-words font-sans text-[13px] leading-5 text-base-content/78">{item}</pre>
        ))}
      </div>
    </section>
  )
}

function formatPlannedParent(
  parentFolderId: string | null,
  parentScope: 'session-root' | 'workspace-root' | undefined,
  explorerItemMap: Map<string, ExplorerItem>
) {
  if (parentFolderId) {
    const folder = explorerItemMap.get(`folder:${parentFolderId}`)
    return `Parent: ${folder?.name ?? parentFolderId}`
  }

  if (parentScope === 'workspace-root') {
    return 'Parent: Workspace root'
  }

  if (parentScope === 'session-root') {
    return 'Parent: Session root'
  }

  return 'Parent: Default root'
}

function formatTagSummary(name: string, color: string | null) {
  return color ? `${name}\nColor: ${color}` : `${name}\nColor: none`
}

function formatDeletionTarget(
  explorerItemMap: Map<string, ExplorerItem>,
  itemType: 'folder' | 'request',
  itemId: string
) {
  return `${itemType}: ${getExplorerItemLabel(explorerItemMap, itemType, itemId)}`
}

function getTagLabel(tagMap: Map<string, TagRecord>, tagId: string) {
  return tagMap.get(tagId)?.name ?? tagId
}

function getExplorerItemLabel(explorerItemMap: Map<string, ExplorerItem>, itemType: 'folder' | 'request', itemId: string) {
  const item = explorerItemMap.get(`${itemType}:${itemId}`)
  if (!item) {
    return itemId
  }

  return item.name
}

function formatItemTagUpdate(
  update: ManagementAgentItemTagUpdatePlanItem,
  explorerItemMap: Map<string, ExplorerItem>,
  tagMap: Map<string, TagRecord>
) {
  const tagLabels = update.tagIds.length > 0 ? update.tagIds.map(tagId => getTagLabel(tagMap, tagId)).join(', ') : 'none'
  return `${getExplorerItemLabel(explorerItemMap, update.itemType, update.itemId)}\nTags: ${tagLabels}`
}

function formatTagItemUpdate(
  update: ManagementAgentTagItemUpdatePlanItem,
  explorerItemMap: Map<string, ExplorerItem>,
  tagMap: Map<string, TagRecord>
) {
  const itemLabels = update.items.length > 0
    ? update.items.map(item => `${item.itemType}: ${getExplorerItemLabel(explorerItemMap, item.itemType, item.itemId)}`).join('\n')
    : 'none'
  return `${getTagLabel(tagMap, update.tagId)}\nItems:\n${itemLabels}`
}

function TranscriptPart({ part }: { part: ManagementAgentMessagePart }) {
  return (
    <details className="bg-base-200/20 text-[12px]" open={part.type === 'text'}>
      <summary className={[ 'cursor-pointer list-none px-2 py-1 font-medium', part.type === 'text' ? 'text-base-content' : 'text-base-content/55' ].join(' ')}>
        {getTranscriptPartTitle(part)}
      </summary>
      <div className="border-t border-base-content/8 px-3 py-2">
        <pre className="whitespace-pre-wrap break-words leading-5 text-base-content/72">{getTranscriptPartContent(part)}</pre>
      </div>
    </details>
  )
}

function getTranscriptPartTitle(part: ManagementAgentMessagePart) {
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
      return 'Step started'
    case 'step-finish':
      return 'Step finished'
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

function getTranscriptPartContent(part: ManagementAgentMessagePart) {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return part.text
    case 'tool':
      return [part.input ? `Input:\n${part.input}` : null, part.output ? `Output:\n${part.output}` : null, part.errorMessage ? `Error:\n${part.errorMessage}` : null].filter(Boolean).join('\n\n') || 'No details yet.'
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

function readSelectedSessionId(scope: ManagementAgentScope) {
  return window.localStorage.getItem(getSelectedSessionStorageKey(scope))
}

function writeSelectedSessionId(scope: ManagementAgentScope, sessionId: string | null) {
  const key = getSelectedSessionStorageKey(scope)
  if (!sessionId) {
    window.localStorage.removeItem(key)
    return
  }

  window.localStorage.setItem(key, sessionId)
}

function getSelectedSessionStorageKey(scope: ManagementAgentScope) {
  return scope.scopeType === 'request'
    ? `management-agent-selected-session:request:${scope.targetRequestId ?? 'no-request'}`
    : `management-agent-selected-session:${scope.scopeType}:${scope.targetFolderId ?? 'no-folder'}`
}

function getManagementAgentDialogTitle(scope: ManagementAgentScope) {
  switch (scope.scopeType) {
    case 'workspace':
      return 'Manage with AI'
    case 'folder':
      return 'Manage with AI - Folder'
    case 'request':
      return 'Manage with AI - Request'
    default:
      return Typescript.assertUnreachable(scope.scopeType)
  }
}

function isSameManagementScope(left: ManagementAgentScope, right: ManagementAgentScope) {
  if (left.scopeType !== right.scopeType) {
    return false
  }

  if (left.scopeType === 'request') {
    return left.targetRequestId === right.targetRequestId
  }

  return left.targetFolderId === right.targetFolderId && left.targetRequestId === right.targetRequestId
}

function isCaretOnFirstLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(0, textarea.selectionStart).includes('\n')
}

function isCaretOnLastLine(textarea: HTMLTextAreaElement) {
  return !textarea.value.slice(textarea.selectionEnd).includes('\n')
}
