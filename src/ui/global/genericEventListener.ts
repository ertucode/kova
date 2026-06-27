import { RequestSendCoordinator } from '@/folders/requestSendCoordinator'
import { getWindowElectron } from '@/getWindowElectron'
import { CookiesCoordinator } from '@/folders/cookiesCoordinator'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'
import { folderRunStore } from '@/folders/folderRunStore'
import { requestExecutionStore } from '@/folders/requestExecutionStore'
import { ScriptAiReviewCoordinator } from '@/folders/scriptAiReviewStore'
import { toast } from '@/lib/components/toast'
import { dialogActions } from './dialogStore'

export function subscribeToGenericEvents() {
  getWindowElectron().onGenericEvent(e => {
    if (e.type === 'reload-path') {
    } else if (e.type === 'cookies-updated') {
      void CookiesCoordinator.loadCookies()
    } else if (e.type === 'environments-updated') {
      void EnvironmentCoordinator.loadEnvironments()
    } else if (e.type === 'http-sse-stream-updated') {
      requestExecutionStore.trigger.httpSseStreamUpdated({ stream: e.stream })
    } else if (e.type === 'http-sse-stream-cleared') {
      requestExecutionStore.trigger.httpSseStreamCleared({ requestId: e.requestId })
    } else if (e.type === 'websocket-session-updated') {
      requestExecutionStore.trigger.websocketSessionUpdated({ session: e.session })
    } else if (e.type === 'websocket-session-cleared') {
      requestExecutionStore.trigger.websocketSessionCleared({ requestId: e.requestId })
    } else if (e.type === 'script-toast-show') {
      toast.show(e.toast)
    } else if (e.type === 'script-toast-hide') {
      toast.hide(e.id)
    } else if (e.type === 'script-prompt-request') {
      void dialogActions.promptText(e.prompt.options).then(value =>
        getWindowElectron().resolveScriptPrompt({ id: e.prompt.id, value })
      )
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
      void RequestSendCoordinator.sendRequestById(e.requestId, e.requestMetadata).catch(error => {
        console.error('retry-request failed', error)
      })
    } else if (e.type === 'folder-run-started') {
      folderRunStore.trigger.runStarted({ run: e.run })
    } else if (e.type === 'folder-run-request-started') {
      folderRunStore.trigger.requestStarted({
        runId: e.runId,
        requestId: e.requestId,
        startedAt: e.startedAt,
        summary: e.summary,
      })
    } else if (e.type === 'folder-run-request-completed') {
      folderRunStore.trigger.requestCompleted({ runId: e.runId, request: e.request, summary: e.summary })
    } else if (e.type === 'folder-run-completed') {
      folderRunStore.trigger.runCompleted({
        runId: e.runId,
        folderId: e.folderId,
        status: e.status,
        completedAt: e.completedAt,
        summary: e.summary,
      })
    } else if (e.type === 'script-ai-state-updated') {
      ScriptAiReviewCoordinator.applyWorkspaceState(e.state)
    } else if (e.type === 'import-agent-state-updated') {
      return
    } else {
      const _exhaustiveCheck: never = e
      return _exhaustiveCheck
    }
  })
}
