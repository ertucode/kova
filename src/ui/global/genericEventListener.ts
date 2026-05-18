import { RequestSendCoordinator } from '@/folders/requestSendCoordinator'
import { getWindowElectron } from '@/getWindowElectron'
import { CookiesCoordinator } from '@/folders/cookiesCoordinator'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'
import { requestExecutionStore } from '@/folders/requestExecutionStore'
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
          await RequestSendCoordinator.sendRequestById(e.request.requestId)
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
    } else {
      const _exhaustiveCheck: never = e
      return _exhaustiveCheck
    }
  })
}
