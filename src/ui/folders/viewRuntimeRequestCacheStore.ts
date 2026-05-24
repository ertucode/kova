import type { ViewRuntimeScriptResponse } from './viewRuntimeProtocol'

const cacheByViewId = new Map<string, Map<string, ViewRuntimeScriptResponse>>()

export function getCachedViewRuntimeRequest(viewId: string, key: string) {
  return cacheByViewId.get(viewId)?.get(key) ?? null
}

export function setCachedViewRuntimeRequest(viewId: string, key: string, response: ViewRuntimeScriptResponse) {
  const cache = cacheByViewId.get(viewId) ?? new Map<string, ViewRuntimeScriptResponse>()
  cache.set(key, response)
  cacheByViewId.set(viewId, cache)
}

export function clearCachedViewRuntimeRequests(viewId: string) {
  cacheByViewId.delete(viewId)
}
