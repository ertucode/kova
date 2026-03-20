import { getWindowElectron } from '@/getWindowElectron'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'
import { requestExecutionStore } from '@/folders/requestExecutionStore'

export function subscribeToGenericEvents() {
  getWindowElectron().onGenericEvent(e => {
    if (e.type === 'reload-path') {
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
    } else {
      const _exhaustiveCheck: never = e
      return _exhaustiveCheck
    }
  })
}
