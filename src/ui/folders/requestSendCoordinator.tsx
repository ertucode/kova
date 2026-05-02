import { confirmation } from '@/lib/components/confirmation'
import { getWarnBeforeRequestAfterSeconds } from '@/global/appSettingsStore'
import { getWindowElectron } from '@/getWindowElectron'
import { errorResponseToMessage } from '@common/GenericError'
import { environmentEditorStore } from './environmentEditorStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { RequestExecutionCoordinator, requestExecutionStore } from './requestExecutionStore'

export namespace RequestSendCoordinator {
  export async function sendSelectedRequest() {
    const state = folderExplorerEditorStore.getSnapshot().context
    const selected = state.selected
    if (!selected || selected.itemType !== 'request') {
      requestExecutionStore.trigger.requestFailed({ requestId: 'unknown', error: 'Request selection is missing' })
      throw new Error('Request selection is missing')
    }

    const entry = state.entries[`request:${selected.id}`]
    const latestDraft = entry?.current
    if (!latestDraft || latestDraft.itemType !== 'request') {
      requestExecutionStore.trigger.requestFailed({ requestId: selected.id, error: 'Request draft is missing' })
      throw new Error('Request draft is missing')
    }

    const activeEnvironments = getActiveEnvironments()
    const warnBeforeRequestAfterSeconds = getWarnBeforeRequestAfterSeconds()
    if (
      shouldWarnBeforeRequest(
        requestExecutionStore.getSnapshot().context.lastRequestSentAt,
        warnBeforeRequestAfterSeconds,
        activeEnvironments
      )
    ) {
      const confirmed = await confirmRequestWithActiveEnvironments(activeEnvironments, warnBeforeRequestAfterSeconds)
      if (!confirmed) {
        throw new Error('Request cancelled')
      }
    }

    const sentAt = Date.now()
    requestExecutionStore.trigger.requestStarted({ requestId: selected.id, sentAt })
    requestExecutionStore.trigger.httpSseStreamCleared({ requestId: selected.id })

    const result = await getWindowElectron().sendRequest({
      requestId: selected.id,
      method: latestDraft.method,
      url: latestDraft.url,
      pathParams: latestDraft.pathParams,
      searchParams: latestDraft.searchParams,
      auth: latestDraft.auth,
      preRequestScript: latestDraft.preRequestScript,
      postRequestScript: latestDraft.postRequestScript,
      headers: latestDraft.headers,
      body: latestDraft.body,
      bodyType: latestDraft.bodyType,
      rawType: latestDraft.rawType,
      activeEnvironmentIds: state.activeEnvironmentIds,
      saveToHistory: latestDraft.saveToHistory,
      historyKeepLast: requestExecutionStore.getSnapshot().context.historyKeepLast,
    })

    if (!result.success) {
      const error = errorResponseToMessage(result.error)
      requestExecutionStore.trigger.requestFailed({
        requestId: selected.id,
        error,
        scriptErrors: result.error.type === 'message' ? result.error.scriptErrors : undefined,
      })
      throw new Error(error)
    }

    requestExecutionStore.trigger.requestSucceeded({
      requestId: selected.id,
      requestName: latestDraft.name,
      requestDraft: latestDraft,
      response: result.data,
    })
    void RequestExecutionCoordinator.refreshHistory()
  }

  export async function sendRequestById(requestId: string) {
    await FolderExplorerCoordinator.selectItem({ itemType: 'request', id: requestId })
    await sendSelectedRequest()
  }
}

function getActiveEnvironments() {
  const folderState = folderExplorerEditorStore.getSnapshot().context
  const environmentState = environmentEditorStore.getSnapshot().context

  return environmentState.items
    .filter(environment => folderState.activeEnvironmentIds.includes(environment.id))
    .map(environment => {
      const environmentDraft = environmentState.entries[environment.id]?.current
      return {
        ...environment,
        name: environmentDraft?.name ?? environment.name,
        color: environmentDraft?.color ?? environment.color,
        warnOnRequest: environmentDraft?.warnOnRequest ?? environment.warnOnRequest,
        priority: environmentDraft?.priority ?? environment.priority,
      }
    })
}

function shouldWarnBeforeRequest(
  lastRequestSentAt: number | null,
  warnBeforeRequestAfterSeconds: number,
  activeEnvironments: Array<{ warnOnRequest: boolean }>
) {
  if (!activeEnvironments.some(environment => environment.warnOnRequest)) {
    return false
  }

  if (lastRequestSentAt === null) {
    return true
  }

  return Date.now() - lastRequestSentAt > warnBeforeRequestAfterSeconds * 1000
}

function confirmRequestWithActiveEnvironments(
  activeEnvironments: Array<{
    id: string
    name: string
    color: string | null
    warnOnRequest: boolean
    priority: number
  }>,
  warnBeforeRequestAfterSeconds: number
) {
  return new Promise<boolean>(resolve => {
    confirmation.trigger.confirm({
      title: 'Send request?',
      message: (
        <ActiveEnvironmentConfirmation
          environments={activeEnvironments}
          warnBeforeRequestAfterSeconds={warnBeforeRequestAfterSeconds}
        />
      ),
      confirmText: 'Send request',
      rejectText: 'Cancel',
      onConfirm: () => resolve(true),
      onReject: () => resolve(false),
    })
  })
}

function ActiveEnvironmentConfirmation({
  environments,
  warnBeforeRequestAfterSeconds,
}: {
  environments: Array<{ id: string; name: string; color: string | null; warnOnRequest: boolean; priority: number }>
  warnBeforeRequestAfterSeconds: number
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/70">
        More than {warnBeforeRequestAfterSeconds} seconds passed since the last request. These active environments will
        be used for this request.
      </p>

      <div className="space-y-2">
        {environments.map(environment => (
          <div
            key={environment.id}
            className="flex items-center gap-3 rounded-xl border border-base-content/10 bg-base-200/40 px-3 py-2"
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-base-content/10"
              style={{ backgroundColor: environment.color ?? 'var(--color-base-content)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-base-content">{environment.name}</span>
            <span className="text-[11px] text-base-content/45">Priority {environment.priority}</span>
            {environment.warnOnRequest ? (
              <span className="rounded-full bg-warning/15 px-2 py-1 text-[11px] font-medium text-warning">Warn</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
