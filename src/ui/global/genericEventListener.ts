import { getWindowElectron } from '@/getWindowElectron'

export function subscribeToGenericEvents() {
  getWindowElectron().onGenericEvent(e => {
    if (e.type === 'reload-path') {
    } else {
      const _exhaustiveCheck: never = e?.type
      return _exhaustiveCheck
    }
  })
}
