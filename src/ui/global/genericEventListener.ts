import { RequestSendCoordinator } from '@/folders/requestSendCoordinator'
import { getWindowElectron } from '@/getWindowElectron'
import { CookiesCoordinator } from '@/folders/cookiesCoordinator'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'
import { FolderRunCoordinator, folderRunStore } from '@/folders/folderRunStore'
import { requestExecutionStore } from '@/folders/requestExecutionStore'
import { ScriptAiReviewCoordinator } from '@/folders/scriptAiReviewStore'
import { RequestBatchCoordinator } from '@/folders/requestBatchStore'
import { toast } from '@/lib/components/toast'
import { Typescript } from '@common/Typescript'
import { dialogActions } from './dialogStore'
import { folderExplorerEditorStore } from '@/folders/folderExplorerEditorStore'

export function subscribeToGenericEvents() {
  getWindowElectron().onGenericEvent(e => {
    if (e.type === 'reload-path') {
      return
    } else if (e.type === 'fix-request-search-param-value') {
      return
    } else if (e.type === 'copy-request-final-value') {
      return
    } else if (e.type === 'cookies-updated') {
      void CookiesCoordinator.loadCookies()
    } else if (e.type === 'environments-updated') {
      void EnvironmentCoordinator.loadEnvironments()
    } else if (e.type === 'http-sse-stream-updated') {
      if (!isRequestTabOpen(e.tabId, e.stream.requestId)) return
      requestExecutionStore.trigger.httpSseStreamUpdated({ tabId: e.tabId, stream: e.stream })
    } else if (e.type === 'http-sse-stream-cleared') {
      if (!isFolderExplorerTabOpen(e.tabId)) return
      requestExecutionStore.trigger.httpSseStreamCleared({ tabId: e.tabId })
    } else if (e.type === 'websocket-session-updated') {
      if (!isRequestTabOpen(e.tabId, e.session.requestId)) return
      requestExecutionStore.trigger.websocketSessionUpdated({ tabId: e.tabId, session: e.session })
    } else if (e.type === 'websocket-session-cleared') {
      requestExecutionStore.trigger.tabExecutionStateCleared({ tabId: e.tabId })
    } else if (e.type === 'script-toast-show') {
      toast.show(e.toast)
    } else if (e.type === 'script-toast-hide') {
      toast.hide(e.id)
    } else if (e.type === 'script-prompt-request') {
      void dialogActions
        .promptText(e.prompt.options)
        .then(value => getWindowElectron().resolveScriptPrompt({ id: e.prompt.id, value }))
    } else if (e.type === 'script-make-request') {
      void (async () => {
        try {
          await RequestSendCoordinator.sendRequestById(e.request.requestId, {
            sourceRuntime: 'navigate-and-call-request',
            isRetry: false,
            retryCount: 0,
          })
          await getWindowElectron().resolveScriptMakeRequest({ id: e.request.id, error: null })
        } catch (error) {
          await getWindowElectron().resolveScriptMakeRequest({
            id: e.request.id,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })()
    } else if (e.type === 'script-call-request') {
      void (async () => {
        try {
          const response = await RequestSendCoordinator.callRequestById(e.request.requestId, e.request.overrides)
          await getWindowElectron().resolveScriptMakeRequest({ id: e.request.id, error: null, response })
        } catch (error) {
          await getWindowElectron().resolveScriptMakeRequest({
            id: e.request.id,
            error: error instanceof Error ? error.message : String(error),
            response: null,
          })
        }
      })()
    } else if (e.type === 'retry-request') {
      void RequestSendCoordinator.sendRequestById(e.requestId, e.requestMetadata, e.tabId).catch(error => {
        console.error('retry-request failed', error)
      })
    } else if (e.type === 'folder-run-started') {
      folderRunStore.trigger.runStarted({ run: e.run })
    } else if (e.type === 'folder-run-progress') {
      folderRunStore.trigger.runProgressed({ runId: e.runId, summary: e.summary, iterations: e.iterations })
    } else if (e.type === 'folder-run-completed') {
      folderRunStore.trigger.runCompleted({
        runId: e.runId,
        folderId: e.folderId,
        status: e.status,
        completedAt: e.completedAt,
        summary: e.summary,
      })
      void FolderRunCoordinator.loadRunDetails(e.runId)
      void FolderRunCoordinator.loadHistory(e.folderId)
    } else if (e.type === 'request-batch-updated') {
      RequestBatchCoordinator.queueBatchUpdate({
        batchId: e.batchId,
        status: e.status,
        summary: e.summary,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
      })
    } else if (e.type === 'request-batch-row-updated') {
      RequestBatchCoordinator.queueRowUpdate({
        batchId: e.batchId,
        rowId: e.rowId,
        status: e.status,
        historyId: e.historyId,
        errorMessage: e.errorMessage,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
      })
    } else if (e.type === 'script-ai-state-updated') {
      ScriptAiReviewCoordinator.applyWorkspaceState(e.state)
    } else if (e.type === 'management-agent-state-updated') {
      return
    } else {
      return Typescript.assertUnreachable(e)
    }
  })
}

function isFolderExplorerTabOpen(tabId: string) {
  return folderExplorerEditorStore.getSnapshot().context.tabs.some(tab => tab.id === tabId)
}

function isRequestTabOpen(tabId: string, requestId: string) {
  return folderExplorerEditorStore
    .getSnapshot()
    .context.tabs.some(tab => tab.id === tabId && tab.itemType === 'request' && tab.itemId === requestId)
}
