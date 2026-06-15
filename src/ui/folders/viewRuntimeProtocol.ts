import type { ScriptPackageArtifact } from '@common/ScriptPackages'
import type { ScriptCallRequestOverrides } from '@common/ScriptMakeRequest'
import type { SharedScriptRecord } from '@common/SharedScripts'

export const VIEW_RUNTIME_READY_EVENT = 'kova-view-runtime-ready'
export const VIEW_RUNTIME_RENDER_EVENT = 'kova-view-runtime-render'
export const VIEW_RUNTIME_TRIGGER_RUN_EVENT = 'kova-view-runtime-trigger-run'
export const VIEW_RUNTIME_CALL_REQUEST_EVENT = 'kova-view-runtime-call-request'
export const VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT = 'kova-view-runtime-call-request-result'
export const VIEW_RUNTIME_CACHE_REQUEST_EVENT = 'kova-view-runtime-cache-request'
export const VIEW_RUNTIME_CACHE_REQUEST_RESULT_EVENT = 'kova-view-runtime-cache-request-result'

export type ViewRuntimeScriptResponse = {
  status: number
  statusText: string
  headers: string
  body:
    | {
        type: 'json'
        data: unknown
      }
    | {
        type: 'text'
        data: string
      }
}

export type ViewRuntimePayload = {
  env: {
    activeValues: Record<string, string>
    environments: Array<{
      id: string
      name: string
      values: Record<string, string>
    }>
    defaultEnvironmentId: string | null
    owners: Record<string, string>
  }
  scope: Record<string, string>
  cache: Record<string, string>
  sharedScripts: Array<Pick<SharedScriptRecord, 'id' | 'name' | 'kind' | 'code' | 'targets' | 'isActive'>>
  scriptPackages: Array<Pick<ScriptPackageArtifact, 'cacheKey' | 'packageName' | 'packageVersion' | 'browserBundleCode'>>
}

export type ViewRuntimeCallRequestMessage = {
  type: typeof VIEW_RUNTIME_CALL_REQUEST_EVENT
  requestId: string
  path: string[]
  overrides?: ScriptCallRequestOverrides
}

export type ViewRuntimeCallRequestResultMessage = {
  type: typeof VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT
  requestId: string
  response: ViewRuntimeScriptResponse | null
  error: string | null
}

export type ViewRuntimeCacheRequestMessage =
  | {
      type: typeof VIEW_RUNTIME_CACHE_REQUEST_EVENT
      requestId: string
      operation: 'set'
      key: string
      value: string
    }
  | {
      type: typeof VIEW_RUNTIME_CACHE_REQUEST_EVENT
      requestId: string
      operation: 'remove'
      key: string
    }

export type ViewRuntimeCacheRequestResultMessage = {
  type: typeof VIEW_RUNTIME_CACHE_REQUEST_RESULT_EVENT
  requestId: string
  error: string | null
}
