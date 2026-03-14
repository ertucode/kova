import { getWindowElectron } from '@/getWindowElectron'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'

export function subscribeToGenericEvents() {
  getWindowElectron().onGenericEvent(e => {
    if (e.type === 'reload-path') {
    } else if (e.type === 'environments-updated') {
      void EnvironmentCoordinator.loadEnvironments()
    } else {
      const _exhaustiveCheck: never = e
      return _exhaustiveCheck
    }
  })
}
