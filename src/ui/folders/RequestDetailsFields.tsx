import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { RequestBodyType, RequestMethod, RequestRawType, SendRequestResponse } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { errorResponseToMessage } from '@common/GenericError'
import { HeadersEditor } from './HeadersEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { KeyValueEditor } from './KeyValueEditor'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { REQUEST_BODY_TYPES, REQUEST_METHODS, REQUEST_RAW_TYPES, type RequestDetailsDraft } from './folderExplorerTypes'

export function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [response, setResponse] = useState<SendRequestResponse | null>(null)
  const [responseError, setResponseError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [responsePaneHeight, setResponsePaneHeight] = useState(320)
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const formattedResponseBody = useMemo(() => {
    if (!response) return ''
    return formatResponseBody(response.body, response.headers)
  }, [response])

  const responseContentType = useMemo(() => getResponseContentType(response?.headers ?? ''), [response?.headers])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const deltaY = resizeState.startY - event.clientY
      setResponsePaneHeight(clampResponsePaneHeight(resizeState.startHeight + deltaY))
    }

    const handlePointerUp = () => {
      resizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const sendRequest = async () => {
    setIsSending(true)
    setResponseError(null)

    const result = await getWindowElectron().sendRequest({
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      body: draft.body,
      bodyType: draft.bodyType,
      rawType: draft.rawType,
    })

    setIsSending(false)

    if (!result.success) {
      setResponse(null)
      setResponseError(errorResponseToMessage(result.error))
      return
    }

    setResponse(result.data)
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: responsePaneHeight,
    }
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="w-full border-b border-base-content/10">
        <div className="flex w-full overflow-hidden border border-base-content/10 bg-base-100/70">
          <select
            className="w-[118px] shrink-0 border-0 border-r border-base-content/10 bg-transparent px-3 py-4 text-sm font-semibold outline-none"
            value={draft.method}
            onChange={event =>
              FolderExplorerCoordinator.updateSelectedDraft({ ...draft, method: event.target.value as RequestMethod })
            }
          >
            {REQUEST_METHODS.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <input
            className="min-w-0 flex-1 border-0 bg-transparent px-4 py-4 text-sm outline-none"
            value={draft.url}
            placeholder="https://api.example.com/resource"
            onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, url: event.target.value })}
          />

          <button
            type="button"
            className="shrink-0 border-0 border-l border-base-content/10 bg-base-200 px-6 py-4 text-sm font-medium text-base-content transition hover:bg-base-300"
            onClick={() => void sendRequest()}
            disabled={isSending}
          >
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 w-full border-b border-base-content/10 md:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <div className="min-h-0 border-b border-base-content/10 md:border-b-0 md:border-r md:border-base-content/10">
          <div className="flex h-full min-h-0 flex-col border-b border-base-content/10">
            <div className="flex items-center gap-3">
              <div className="text-sm text-base-content/55 pl-2">Body</div>
              <select
                className="select select-sm w-auto rounded-none border-base-content/10 bg-base-100/70"
                value={draft.bodyType}
                onChange={event =>
                  FolderExplorerCoordinator.updateSelectedDraft({
                    ...draft,
                    bodyType: event.target.value as RequestBodyType,
                  })
                }
              >
                {REQUEST_BODY_TYPES.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                className="select select-sm w-auto rounded-none border-base-content/10 bg-base-100/70"
                value={draft.rawType}
                onChange={event =>
                  FolderExplorerCoordinator.updateSelectedDraft({
                    ...draft,
                    rawType: event.target.value as RequestRawType,
                  })
                }
                disabled={draft.bodyType !== 'raw'}
              >
                {REQUEST_RAW_TYPES.map(option => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            {draft.bodyType === 'raw' ? (
              <textarea
                className="textarea min-h-0 h-full w-full rounded-none border-base-content/10 bg-base-100/70 font-mono text-sm leading-6"
                value={draft.body}
                placeholder={'{\n  "hello": "world"\n}'}
                onChange={event =>
                  FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: event.target.value })
                }
              />
            ) : null}

            {isParamBodyType(draft.bodyType) ? (
              <KeyValueEditor
                label={draft.bodyType === 'form-data' ? 'Form Data' : 'URL Encoded'}
                value={draft.body}
                onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: value })}
                keyPlaceholder="key"
                valuePlaceholder="value"
              />
            ) : null}

            {draft.bodyType === 'none' ? (
              <div className="flex min-h-0 h-full items-center justify-center border border-base-content/10 bg-base-100/35 text-sm text-base-content/45">
                No request body
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 overflow-auto md:border-l md:border-base-content/10">
          <HeadersEditor
            value={draft.headers}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
          />

          <DetailsTextArea
            label="Pre-request Script"
            value={draft.preRequestScript}
            minHeightClassName="min-h-[180px]"
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
            onBlur={() => undefined}
          />

          <DetailsTextArea
            label="Post-request Script"
            value={draft.postRequestScript}
            minHeightClassName="min-h-[180px]"
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
            onBlur={() => undefined}
          />
        </div>
      </section>

      <section className="shrink-0 bg-base-100/95" style={{ height: `${responsePaneHeight}px` }}>
        <button
          type="button"
          className="block h-px w-full cursor-ns-resize bg-base-content/10"
          onPointerDown={startResize}
          aria-label="Resize response panel"
          title="Resize response panel"
        />

        <div className="h-[calc(100%-1px)] overflow-auto px-8 py-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="text-sm text-base-content/55">Response</div>
            <ResponseStatusSummary response={response} responseError={responseError} />
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
            <ResponseBodyPanel
              value={formattedResponseBody}
              description="Response body will appear here."
              contentType={responseContentType}
            />
            <ResponseHeadersPanel value={response?.headers ?? ''} description="Response headers will appear here." />
          </div>
        </div>
      </section>
    </div>
  )
}

function ResponseBodyPanel({
  value,
  description,
  contentType,
}: {
  value: string
  description: string
  contentType: string | null
}) {
  return (
    <div className="min-h-32 border border-dashed border-base-content/12 bg-base-100/35 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-base-content">Body</div>
        {contentType ? <div className="text-xs text-base-content/45">{contentType}</div> : null}
      </div>

      {value ? (
        <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-base-content">
          {value}
        </pre>
      ) : (
        <div className="mt-2 text-sm text-base-content/50">{description}</div>
      )}
    </div>
  )
}

function ResponseHeadersPanel({ value, description }: { value: string; description: string }) {
  const rows = parseResponseHeaders(value)

  return (
    <div className="min-h-32 border border-dashed border-base-content/12 bg-base-100/35 px-4 py-4">
      <div className="text-sm font-medium text-base-content">Headers</div>

      {rows.length > 0 ? (
        <div className="mt-3 overflow-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="align-top">
                  <td className="w-[42%] pr-4 py-1.5 text-base-content/55">{row.key}</td>
                  <td className="py-1.5 break-words text-base-content">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-2 text-sm text-base-content/50">{description}</div>
      )}
    </div>
  )
}

function ResponseStatusSummary({
  response,
  responseError,
}: {
  response: SendRequestResponse | null
  responseError: string | null
}) {
  const statusTone = getStatusTone(response?.status)

  if (responseError) {
    return (
      <div className="max-w-[420px] text-right whitespace-pre-wrap break-words text-sm text-error">{responseError}</div>
    )
  }

  if (!response) {
    return null
  }

  return (
    <div className="text-right">
      <div className={`text-sm font-semibold ${statusTone.className}`}>
        {response.status} {response.statusText}
      </div>
      <div className="mt-1 text-xs text-base-content/45">{response.durationMs} ms</div>
    </div>
  )
}

function isParamBodyType(bodyType: RequestBodyType) {
  return bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded'
}

function formatResponseBody(body: string, headers: string) {
  if (!body.trim()) return ''

  const contentType = getResponseContentType(headers)?.toLowerCase()

  const looksJson = contentType?.includes('json') || /^[\[{]/.test(body.trim())
  if (!looksJson) {
    return body
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

function getResponseContentType(headers: string) {
  return (
    headers
      .split('\n')
      .find(line => line.toLowerCase().startsWith('content-type:'))
      ?.split(':')
      .slice(1)
      .join(':')
      .trim() ?? null
  )
}

function parseResponseHeaders(value: string) {
  return value
    .split('\n')
    .map((line, index) => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) {
        return null
      }

      return {
        id: `response-header-${index}`,
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter(
      (row): row is { id: string; key: string; value: string } => row !== null && (row.key !== '' || row.value !== '')
    )
}

function getStatusTone(status: number | undefined) {
  if (!status) {
    return { className: 'text-base-content' }
  }

  if (status >= 200 && status < 300) {
    return { className: 'text-success' }
  }

  if (status >= 300 && status < 400) {
    return { className: 'text-info' }
  }

  if (status >= 400 && status < 500) {
    return { className: 'text-warning' }
  }

  return { className: 'text-error' }
}

function clampResponsePaneHeight(height: number) {
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  return Math.max(180, Math.min(height, Math.floor(viewportHeight * 0.8)))
}
