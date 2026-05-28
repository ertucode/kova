import { useEffect, useMemo, useRef, useState } from 'react'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap } from '@common/EnvironmentVariables'
import type { ScriptCallRequestOverrides } from '@common/ScriptMakeRequest'
import type { ScriptPackageArtifact } from '@common/ScriptPackages'
import type { SharedScriptRecord } from '@common/SharedScripts'
import { RequestSendCoordinator } from './requestSendCoordinator'
import { getCachedViewRuntimeRequest, setCachedViewRuntimeRequest } from './viewRuntimeRequestCacheStore'
import {
  VIEW_RUNTIME_CALL_REQUEST_EVENT,
  VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT,
  VIEW_RUNTIME_READY_EVENT,
  VIEW_RUNTIME_RENDER_EVENT,
  VIEW_RUNTIME_TRIGGER_RUN_EVENT,
  type ViewRuntimeCallRequestMessage,
  type ViewRuntimePayload,
  type ViewRuntimeScriptResponse,
} from './viewRuntimeProtocol'

type RuntimeEnvironmentSnapshot = {
  id: string
  name: string
  isActive: boolean
  priority: number
  createdAt: number
  values: Record<string, string>
}

type RequestPathRecord = {
  path: string[]
  requestId: string
}

export function ViewRuntimePreview({
  viewId,
  source,
  rememberRequests,
  runRequestId,
  environments,
  sharedScripts,
  scriptPackages,
  requestPaths,
  onRunHandled,
}: {
  viewId: string
  source: string
  rememberRequests: boolean
  runRequestId: string | null
  environments: RuntimeEnvironmentSnapshot[]
  sharedScripts: SharedScriptRecord[]
  scriptPackages: ScriptPackageArtifact[]
  requestPaths: RequestPathRecord[]
  onRunHandled: (requestId: string) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [isIframeReady, setIsIframeReady] = useState(false)
  const lastHandledRunRequestIdRef = useRef<string | null>(null)

  const payload = useMemo<ViewRuntimePayload>(() => {
    const activeEnvironments = environments
      .filter(environment => environment.isActive)
      .map(environment => ({
        id: environment.id,
        name: environment.name,
        color: null,
        warnOnRequest: false,
        position: 0,
        priority: environment.priority,
        createdAt: environment.createdAt,
        deletedAt: null,
        variables: serializeEnvironmentValues(environment.values),
      }))
    const activeValues = buildEnvironmentVariableMap(activeEnvironments)
    const owners = Object.fromEntries(buildEffectiveEnvironmentOwners(activeEnvironments).entries())

    return {
      env: {
        activeValues,
        environments: environments.map(environment => ({
          id: environment.id,
          name: environment.name,
          values: environment.values,
        })),
        defaultEnvironmentId: activeEnvironments[0]?.id ?? null,
        owners,
      },
      scope: {},
      sharedScripts,
      scriptPackages,
    }
  }, [environments, scriptPackages, sharedScripts])

  const requestPathKeyToId = useMemo(
    () => new Map(requestPaths.map(record => [JSON.stringify(record.path), record.requestId] as const)),
    [requestPaths]
  )

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      if (event.data?.type === VIEW_RUNTIME_READY_EVENT) {
        setIsIframeReady(true)
        return
      }

      if (event.data?.type !== VIEW_RUNTIME_CALL_REQUEST_EVENT) {
        return
      }

      const request = event.data as ViewRuntimeCallRequestMessage
      const requestPathKey = JSON.stringify(request.path)
      const requestId = requestPathKeyToId.get(requestPathKey)

      void (async () => {
        if (!requestId) {
          postCallRequestResult({
            requestId: request.requestId,
            error: `View request path was not found: ${request.path.join(' / ')}`,
            response: null,
          })
          return
        }

        const cacheKey = createRequestCacheKey(request.path, request.overrides)
        if (rememberRequests) {
          const cachedResponse = getCachedViewRuntimeRequest(viewId, cacheKey)
          if (cachedResponse) {
            postCallRequestResult({ requestId: request.requestId, error: null, response: cachedResponse })
            return
          }
        }

        try {
          const response = await RequestSendCoordinator.callRequestById(requestId, request.overrides)
          const normalizedResponse = {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: response.body,
          } satisfies ViewRuntimeScriptResponse

          if (rememberRequests) {
            setCachedViewRuntimeRequest(viewId, cacheKey, normalizedResponse)
          }

          postCallRequestResult({ requestId: request.requestId, error: null, response: normalizedResponse })
        } catch (error) {
          postCallRequestResult({
            requestId: request.requestId,
            error: error instanceof Error ? error.message : String(error),
            response: null,
          })
        }
      })()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [rememberRequests, requestPathKeyToId, viewId])

  useEffect(() => {
    if (!isIframeReady || !iframeRef.current?.contentWindow) {
      return
    }

    iframeRef.current.contentWindow.postMessage(
      {
        type: VIEW_RUNTIME_RENDER_EVENT,
        code: source,
        payload,
      },
      '*'
    )
  }, [isIframeReady, payload, source])

  useEffect(() => {
    if (!isIframeReady || !iframeRef.current?.contentWindow) {
      return
    }

    if (!runRequestId || runRequestId === lastHandledRunRequestIdRef.current) {
      return
    }

    lastHandledRunRequestIdRef.current = runRequestId

    iframeRef.current.contentWindow.postMessage({ type: VIEW_RUNTIME_TRIGGER_RUN_EVENT }, '*')
    onRunHandled(runRequestId)
  }, [isIframeReady, onRunHandled, runRequestId])

  return (
    <iframe
      ref={iframeRef}
      title="View runtime preview"
      sandbox="allow-scripts"
      src="./generated/view-runtime/view-runtime.html"
      className="h-full w-full border border-base-content/10 bg-base-100"
    />
  )

  function postCallRequestResult({
    requestId,
    error,
    response,
  }: {
    requestId: string
    error: string | null
    response: ViewRuntimeScriptResponse | null
  }) {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT,
        requestId,
        error,
        response,
      },
      '*'
    )
  }
}

function serializeEnvironmentValues(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${value}`)
    .join('\n')
}

function createRequestCacheKey(path: string[], overrides: ScriptCallRequestOverrides | undefined) {
  return JSON.stringify({
    path,
    overrides: overrides
      ? {
          method: overrides.method,
          url: overrides.url,
          body: Object.hasOwn(overrides, 'body') ? overrides.body : undefined,
          headers: overrides.headers
            ? Object.fromEntries(Object.entries(overrides.headers).sort(([left], [right]) => left.localeCompare(right)))
            : undefined,
        }
      : undefined,
  })
}
