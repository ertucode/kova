import { useEffect, useMemo, useRef, useState } from 'react'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap } from '@common/EnvironmentVariables'
import type { HttpAuth } from '@common/Auth'
import type { SendRequestResponse } from '@common/Requests'
import type { ScriptPackageArtifact } from '@common/ScriptPackages'
import type { SharedScriptRecord } from '@common/SharedScripts'
import type { RequestDetailsDraft } from './folderExplorerTypes'

type VisualizerEnvironmentSnapshot = {
  id: string
  name: string
  isActive: boolean
  priority: number
  createdAt: number
  values: Record<string, string>
}

type VisualizerResponseApi = {
  status: number
  statusText: string
  headers: Record<string, string>
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

type VisualizerPayload = {
  response: VisualizerResponseApi | null
  request: {
    method: string
    url: string
    pathParams: string
    searchParams: string
    auth: HttpAuth
    body: string
    bodyType: string
    rawType: string
    headers: Array<{ key: string; value: string }>
  }
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
  sharedScripts: Array<Pick<SharedScriptRecord, 'id' | 'name' | 'kind' | 'code' | 'targets' | 'isActive'>>
  scriptPackages: ScriptPackageArtifact[]
}

const READY_EVENT = 'kova-response-visualizer-ready'
const RENDER_EVENT = 'kova-response-visualizer-render'

export function ResponseVisualizerPreview({
  source,
  response,
  contentType,
  requestDraft,
  environments,
  sharedScripts,
  scriptPackages,
}: {
  source: string
  response: SendRequestResponse | null
  contentType: string | null
  requestDraft: Pick<RequestDetailsDraft, 'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType'>
  environments: VisualizerEnvironmentSnapshot[]
  sharedScripts: SharedScriptRecord[]
  scriptPackages: ScriptPackageArtifact[]
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [isIframeReady, setIsIframeReady] = useState(false)

  const payload = useMemo<VisualizerPayload>(() => {
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
    const requestSnapshot = response?.execution.request

    return {
      response: response
        ? {
            status: response.status,
            statusText: response.statusText,
            headers: parseHeadersToObject(response.headers),
            body: parseScriptLikeResponseBody(response.body, contentType),
          }
        : null,
      request: {
        method: requestSnapshot?.method ?? requestDraft.method,
        url: requestSnapshot?.url ?? requestDraft.url,
        pathParams: requestDraft.pathParams,
        searchParams: requestDraft.searchParams,
        auth: requestDraft.auth,
        body: requestSnapshot?.body ?? requestDraft.body,
        bodyType: requestSnapshot?.bodyType ?? requestDraft.bodyType,
        rawType: requestSnapshot?.rawType ?? requestDraft.rawType,
        headers: parseHeadersToEntries(requestSnapshot?.headers ?? requestDraft.headers),
      },
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
      scope: response?.requestScope ?? {},
      sharedScripts,
      scriptPackages,
    }
  }, [contentType, environments, requestDraft, response, scriptPackages, sharedScripts])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      if (event.data?.type === READY_EVENT) {
        setIsIframeReady(true)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  useEffect(() => {
    if (!isIframeReady || !iframeRef.current?.contentWindow) {
      return
    }

    iframeRef.current.contentWindow.postMessage(
      {
        type: RENDER_EVENT,
        code: source,
        payload,
      },
      '*'
    )
  }, [isIframeReady, payload, source])

  return (
    <iframe
      ref={iframeRef}
      title="Response visualizer preview"
      sandbox="allow-scripts"
      src="./generated/response-visualizer/response-visualizer.html"
      className="h-full w-full rounded-xl border border-base-content/10 bg-base-100"
    />
  )
}

function parseScriptLikeResponseBody(body: string, contentType: string | null): VisualizerResponseApi['body'] {
  const normalizedContentType = contentType?.toLowerCase() ?? ''
  const shouldParseJson = normalizedContentType.includes('json') || /^[\[{]/.test(body.trim())

  if (!shouldParseJson) {
    return { type: 'text', data: body }
  }

  try {
    return { type: 'json', data: JSON.parse(body) }
  } catch {
    return { type: 'text', data: body }
  }
}

function parseHeadersToEntries(rawHeaders: string) {
  return rawHeaders
    .split('\n')
    .map(line => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) {
        return null
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null)
}

function parseHeadersToObject(rawHeaders: string) {
  return Object.fromEntries(parseHeadersToEntries(rawHeaders).map(entry => [entry.key, entry.value]))
}

function serializeEnvironmentValues(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${value}`)
    .join('\n')
}
