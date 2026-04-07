import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { CopyIcon, SaveIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import {
  APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES,
  type AppSettingsResponseBodyDisplayMode,
} from '@common/AppSettings'
import { isSseContentType, parseSseEvents } from '@common/Sse'
import type { HttpSseStreamState, RequestScriptError, SendRequestResponse, SseEventRecord } from '@common/Requests'
import { formatJson } from '@common/Json5'
import { getWindowElectron } from '@/getWindowElectron'
import { dialogActions } from '@/global/dialogStore'
import { toast } from '@/lib/components/toast'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { CodeEditor, type CodeEditorLanguage } from './CodeEditor'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { SseTranscript } from './SseTranscript'
import { RequestHistoryDialog } from './RequestHistoryDialog'
import { ResponseVisualizerPreview } from './ResponseVisualizerPreview'
import { folderExplorerEditorStore, saveFolderExplorerUiState } from './folderExplorerEditorStore'
import { requestExecutionStore } from './requestExecutionStore'
import { AppSettingsCoordinator, appSettingsStore } from '@/global/appSettingsStore'

const readOnlyCodeEditorOnChange = () => undefined
export function RequestDetailsResponsePanel({
  isSending,
  draft,
  onJumpToScriptError,
  visualizerEnvironments,
}: {
  isSending: boolean
  draft: RequestDetailsDraft
  onJumpToScriptError: (error: RequestScriptError) => void
  visualizerEnvironments: Array<{
    id: string
    name: string
    isActive: boolean
    priority: number
    createdAt: number
    values: Record<string, string>
  }>
}) {
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const responsePaneHeight = useSelector(folderExplorerEditorStore, state => state.context.responsePaneHeight)
  const responseBodyDisplayMode = useSelector(
    appSettingsStore,
    state => state.context.settings?.responseBodyDisplayMode ?? 'raw'
  )
  const response = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.responseByRequestId[selectedRequestId] ?? null) : null
  )
  const responseError = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.errorByRequestId[selectedRequestId] ?? null) : null
  )
  const scriptErrors = useSelector(requestExecutionStore, state =>
    selectedRequestId
      ? (state.context.scriptErrorsByRequestId[selectedRequestId] ?? EMPTY_SCRIPT_ERRORS)
      : EMPTY_SCRIPT_ERRORS
  )
  const sseStream = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.httpSseByRequestId[selectedRequestId] ?? null) : null
  )
  const [isResizingResponsePane, setIsResizingResponsePane] = useState(false)
  const [requestHistoryCount, setRequestHistoryCount] = useState<number | null>(null)
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const responseBodyRequestSelection = useMemo(
    () => (selectedRequestId ? { itemType: 'request' as const, id: selectedRequestId } : null),
    [selectedRequestId]
  )
  const responseVisualizerRequestDraft = useMemo<
    Pick<RequestDetailsDraft, 'method' | 'url' | 'headers' | 'body' | 'bodyType' | 'rawType'>
  >(
    () => ({
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      body: draft.body,
      bodyType: draft.bodyType,
      rawType: draft.rawType,
    }),
    [draft.body, draft.bodyType, draft.headers, draft.method, draft.rawType, draft.url]
  )
  const responseContentType = useMemo(() => getResponseContentType(response?.headers ?? ''), [response?.headers])
  const sseStreamContentType = useMemo(() => getResponseContentType(sseStream?.headers ?? ''), [sseStream?.headers])
  const responseSseEvents = useMemo(
    () => (response && isSseContentType(responseContentType) ? parseSseEvents(response.body) : []),
    [response, responseContentType]
  )
  const displayedSseEvents = sseStream?.events.length ? sseStream.events : responseSseEvents
  const shouldShowSsePanel = isSseContentType(sseStreamContentType) || isSseContentType(responseContentType)
  const visibleResponseError = scriptErrors.length > 0 ? null : responseError
  const formattedResponseBody = useMemo(() => {
    if (!response) {
      return ''
    }

    return formatResponseBody(response.body, response.headers)
  }, [response])

  const saveCurrentResponseAsExample = useCallback(async () => {
    if (!selectedRequestId) {
      return
    }

    const responseSource = response
      ? {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response.body,
        }
      : sseStream && sseStream.body.trim()
        ? {
            status: sseStream.status ?? 0,
            statusText: sseStream.statusText || (sseStream.state === 'cancelled' ? 'Cancelled' : 'Streaming Response'),
            headers: sseStream.headers,
            body: sseStream.body,
          }
        : null

    if (!responseSource) {
      return
    }

    const result = await getWindowElectron().createRequestExample({
      requestId: selectedRequestId,
      name: `${draft.name} ${responseSource.status || responseSource.statusText}`,
      requestHeaders: draft.headers,
      requestBody: draft.body,
      requestBodyType: draft.bodyType,
      requestRawType: draft.rawType,
      responseStatus: responseSource.status,
      responseStatusText: responseSource.statusText,
      responseHeaders: responseSource.headers,
      responseBody: responseSource.body,
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    await FolderExplorerCoordinator.loadItems()
    FolderExplorerCoordinator.selectItem({ itemType: 'example', id: result.data.id })
    toast.show({ severity: 'success', title: 'Example saved', message: `Saved response example for ${draft.name}.` })
  }, [draft, response, selectedRequestId, sseStream])

  const updateResponseTableAccessor = useCallback(
    (value: string) => {
      FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseTableAccessor: value })
    },
    [draft]
  )

  useEffect(() => {
    if (!selectedRequestId) {
      setRequestHistoryCount(null)
      return
    }

    let isCancelled = false
    void getWindowElectron()
      .getRequestHistoryCount({ requestId: selectedRequestId })
      .then(result => {
        if (!isCancelled) {
          setRequestHistoryCount(result.totalCount)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setRequestHistoryCount(0)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [selectedRequestId, isSending, response?.execution.response?.receivedAt, responseError, scriptErrors.length, sseStream?.state])

  useEffect(() => {
    const clampedHeight = clampResponsePaneHeight(responsePaneHeight)
    if (clampedHeight !== responsePaneHeight) {
      folderExplorerEditorStore.trigger.responsePaneHeightChanged({ height: clampedHeight })
    }
  }, [responsePaneHeight])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      const deltaY = resizeState.startY - event.clientY
      folderExplorerEditorStore.trigger.responsePaneHeightChanged({
        height: clampResponsePaneHeight(resizeState.startHeight + deltaY),
      })
    }

    const handlePointerUp = () => {
      const wasResizing = resizeStateRef.current !== null
      resizeStateRef.current = null
      setIsResizingResponsePane(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (wasResizing) {
        const { selected, expandedIds } = folderExplorerEditorStore.getSnapshot().context
        saveFolderExplorerUiState(selected, expandedIds)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: responsePaneHeight,
    }
    setIsResizingResponsePane(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <section
      className="relative shrink-0 overflow-hidden bg-base-100/95"
      style={{ height: `${responsePaneHeight}px` }}
    >
      <button
        type="button"
        className={`block h-[3px] w-full cursor-ns-resize border-0 transition-colors ${
          isResizingResponsePane ? 'bg-base-content/35' : 'bg-base-content/10 hover:bg-base-content/25'
        } `}
        onPointerDown={startResize}
        aria-label="Resize response panel"
        title="Resize response panel"
      />

      <div className="relative flex h-[calc(100%-2px)] min-h-0 flex-col overflow-hidden">
        {isSending ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px overflow-hidden bg-base-content/8">
              <div className="h-full w-1/3 animate-[request-loading_1.25s_ease-in-out_infinite] rounded-full bg-info/80 shadow-[0_0_18px_rgba(59,130,246,0.4)]" />
            </div>
          </>
        ) : null}
        <ResponseScriptErrors errors={scriptErrors} onJumpToError={onJumpToScriptError} />
        <div
          className={`flex min-h-0 flex-1 overflow-hidden transition duration-200 ${
            isSending ? 'pointer-events-none blur-[1.5px] saturate-50 opacity-60' : ''
          }`}
        >
          {shouldShowSsePanel ? (
            <SseResponsePanel
              stream={sseStream}
              response={response}
              responseError={visibleResponseError}
              requestId={selectedRequestId}
              requestName={draft.name}
              requestHistoryCount={requestHistoryCount}
              events={displayedSseEvents}
              onSaveAsExample={
                response || (sseStream && sseStream.body.trim()) ? () => void saveCurrentResponseAsExample() : undefined
              }
            />
          ) : (
            <>
              <ResponseBodyPanel
                value={formattedResponseBody}
                rawBody={response?.body ?? ''}
                headers={response?.headers ?? ''}
                requestId={selectedRequestId}
                requestName={draft.name}
                requestHistoryCount={requestHistoryCount}
                description="Response body will appear here."
                headersDescription="Response headers will appear here."
                contentType={responseContentType}
                responseVisualizer={draft.responseVisualizer}
                responseTableAccessor={draft.responseTableAccessor}
                preferredResponseBodyView={draft.preferredResponseBodyView}
                responseBodyDisplayMode={responseBodyDisplayMode}
                requestSelection={responseBodyRequestSelection}
                requestDraft={responseVisualizerRequestDraft}
                onUpdateResponseTableAccessor={updateResponseTableAccessor}
                onUpdateResponseBodyDisplayMode={AppSettingsCoordinator.saveResponseBodyDisplayMode}
                environments={visualizerEnvironments}
                response={response}
                responseError={visibleResponseError}
                onSaveAsExample={response ? () => void saveCurrentResponseAsExample() : undefined}
              />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

const ResponseScriptErrors = memo(function ResponseScriptErrors({
  errors,
  onJumpToError,
}: {
  errors: RequestScriptError[]
  onJumpToError: (error: RequestScriptError) => void
}) {
  if (errors.length === 0) {
    return null
  }

  return (
    <div className="group relative block">
      <div className="border-b border-error/18 bg-error/6 text-sm text-base-content/82 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-error)_10%,transparent)]">
        {errors.map(error => (
          <button
            key={`${error.phase}-${error.sourceName}-${error.line ?? 'unknown'}-${error.compactMessage}`}
            type="button"
            className="block w-full cursor-pointer border-b border-error/10 px-3 py-2 text-left transition last:border-b-0 hover:bg-error/8 hover:text-base-content"
            onClick={() => onJumpToError(error)}
          >
            <span className="font-medium text-error">{error.compactLabel}</span> <span>{error.compactMessage}</span>
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 hidden w-[min(42rem,calc(100vw-2rem))] group-hover:block group-focus-within:block">
        <div className="overflow-hidden rounded-xl border border-base-content/12 bg-base-100/98 shadow-[0_18px_50px_rgba(0,0,0,0.18)] backdrop-blur">
          <div className="border-b border-base-content/10 bg-base-200/65 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55">
            Script Error Details
          </div>
          <div className="max-h-[24rem] overflow-auto p-3">
            {errors.map(error => (
              <div
                key={`detail-${error.phase}-${error.sourceName}-${error.line ?? 'unknown'}-${error.compactMessage}`}
                className="border-b border-base-content/10 px-1 py-2 last:border-b-0"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-error">{error.compactLabel}</span>
                  <span className="text-base-content/80">{error.compactMessage}</span>
                </div>
                <div className="mt-2 text-xs leading-5 text-base-content/58">
                  <div>{error.sourceName}</div>
                  {error.line !== null ? (
                    <div>
                      line {error.line}
                      {error.column !== null ? `, column ${error.column}` : ''}
                    </div>
                  ) : null}
                </div>
                {error.sourceLine ? (
                  <pre className="mt-2 overflow-auto rounded-lg border border-base-content/10 bg-base-200/55 px-3 py-2 text-xs leading-5 text-base-content/82">
                    <code>{error.sourceLine}</code>
                  </pre>
                ) : null}
                <div className="mt-2 text-xs leading-5 text-base-content/72">{error.message}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

const ResponseBodyPanel = memo(function ResponseBodyPanel({
  value,
  rawBody,
  headers,
  requestId,
  requestName,
  requestHistoryCount,
  description,
  headersDescription,
  contentType,
  responseVisualizer,
  responseTableAccessor,
  preferredResponseBodyView,
  responseBodyDisplayMode,
  requestSelection,
  requestDraft,
  onUpdateResponseTableAccessor,
  onUpdateResponseBodyDisplayMode,
  environments,
  response,
  responseError,
  onSaveAsExample,
}: {
  value: string
  rawBody: string
  headers: string
  requestId: string | null
  requestName: string
  requestHistoryCount: number | null
  description: string
  headersDescription: string
  contentType: string | null
  responseVisualizer: string
  responseTableAccessor: string
  preferredResponseBodyView: 'raw' | 'table' | 'visualizer'
  responseBodyDisplayMode: AppSettingsResponseBodyDisplayMode
  requestSelection: { itemType: 'request'; id: string } | null
  requestDraft: Pick<RequestDetailsDraft, 'method' | 'url' | 'headers' | 'body' | 'bodyType' | 'rawType'>
  onUpdateResponseTableAccessor: (value: string) => void
  onUpdateResponseBodyDisplayMode: (mode: AppSettingsResponseBodyDisplayMode) => Promise<boolean>
  environments: Array<{
    id: string
    name: string
    isActive: boolean
    priority: number
    createdAt: number
    values: Record<string, string>
  }>
  response: SendRequestResponse | null
  responseError: string | null
  onSaveAsExample?: () => void
}) {
  const language = detectResponseLanguage(contentType, rawBody)
  const supportsCollapsing = language === 'json' || language === 'xml' || language === 'html'
  const hasResponseVisualizer = responseVisualizer.trim().length > 0
  const canRenderVisualizer = hasResponseVisualizer && response !== null
  const responseBodySize = useMemo(() => formatBytes(getByteLength(rawBody)), [rawBody])
  const hasFormattedBody = value.trim().length > 0 && value !== rawBody
  const displayedRawBody = responseBodyDisplayMode === 'formatted' && hasFormattedBody ? value : rawBody
  const responseHeaderRows = useMemo(() => parseResponseHeaders(headers), [headers])
  const parsedStructuredResponse = useMemo(() => parseStructuredResponse(rawBody, contentType), [contentType, rawBody])
  const tableResolution = useMemo(
    () => resolveResponseTableRows(parsedStructuredResponse, responseTableAccessor),
    [parsedStructuredResponse, responseTableAccessor]
  )
  const [viewMode, setViewMode] = useState<'raw' | 'table' | 'visualizer'>(preferredResponseBodyView)
  const [section, setSection] = useState<'body' | 'headers'>('body')
  const canCopyResponseSection = section === 'body' ? displayedRawBody.trim().length > 0 : responseHeaderRows.length > 0
  const historyButtonLabel =
    requestHistoryCount === null ? 'Loading History...' : requestHistoryCount > 0 ? `Show History (${requestHistoryCount})` : 'No History'
  const sectionOptions = useMemo(
    () => [
      { value: 'body' as const, label: 'Body' },
      { value: 'headers' as const, label: 'Headers' },
    ],
    []
  )
  const displayModeOptions = useMemo(
    () =>
      APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.map(mode => ({
        value: mode,
        label: mode === 'raw' ? 'Original' : 'Formatted',
      })),
    []
  )
  const viewModeOptions = useMemo(
    () => [
      { value: 'raw' as const, label: 'Raw' },
      { value: 'table' as const, label: 'Table' },
      { value: 'visualizer' as const, label: 'Visualizer' },
    ],
    []
  )

  useEffect(() => {
    setViewMode(preferredResponseBodyView)
  }, [preferredResponseBodyView])

  const updatePreferredResponseBodyView = async (nextView: 'raw' | 'table' | 'visualizer') => {
    if (!requestSelection) {
      return false
    }

    return await FolderExplorerCoordinator.updateRequestResponseBodyViewPreference(requestSelection, nextView)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100/35 p-2">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="text-sm font-medium text-base-content">Response</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-[11px] font-semibold text-base-content/70 transition hover:border-base-content/20 hover:text-base-content disabled:cursor-default disabled:opacity-45"
            onClick={() => {
              if (!requestId || !requestHistoryCount) {
                return
              }

              dialogActions.open({
                component: RequestHistoryDialog,
                props: { requestId, requestName },
              })
            }}
            disabled={!requestId || requestHistoryCount === null || requestHistoryCount === 0}
          >
            {historyButtonLabel}
          </button>
          <DropdownSelect
            value={section}
            className="w-[132px]"
            triggerClassName="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-[11px] font-semibold"
            menuClassName="w-[180px]"
            options={sectionOptions}
            onChange={setSection}
          />
          {section === 'body' ? (
            <DropdownSelect
              value={viewMode}
              className="w-[132px]"
              triggerClassName="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-[11px] font-semibold"
              menuClassName="w-[180px]"
              options={viewModeOptions}
              onChange={nextView => {
                void updatePreferredResponseBodyView(nextView).then(success => {
                  if (success) {
                    setViewMode(nextView)
                  }
                })
              }}
            />
          ) : null}
          {section === 'body' && viewMode === 'raw' && hasFormattedBody ? (
            <DropdownSelect
              value={responseBodyDisplayMode}
              className="w-[132px]"
              triggerClassName="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-[11px] font-semibold"
              menuClassName="w-[180px]"
              options={displayModeOptions}
              onChange={mode => {
                void onUpdateResponseBodyDisplayMode(mode)
              }}
            />
          ) : null}
          {canCopyResponseSection ? (
            <button
              type="button"
              className="rounded-lg bg-base-100/70 text-[11px] font-semibold text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
              onClick={() =>
                void copyTextToClipboard(
                  section === 'body' ? displayedRawBody : headers,
                  section === 'body' ? 'Response body copied to clipboard.' : 'Response headers copied to clipboard.'
                )
              }
              title={section === 'body' ? 'Copy Response Body' : 'Copy Response Headers'}
              aria-label={section === 'body' ? 'Copy response body' : 'Copy response headers'}
            >
              <CopyIcon className="h-4 w-4" />
            </button>
          ) : null}
          {section === 'body' && onSaveAsExample ? (
            <button
              type="button"
              className="rounded-lg bg-base-100/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
              onClick={onSaveAsExample}
            >
              <SaveIcon className="h-4 w-4" />
            </button>
          ) : null}
          {contentType ? <div className="text-xs text-base-content/45">{contentType}</div> : null}
          {response ? <div className="text-xs text-base-content/45">{responseBodySize}</div> : null}
          <ResponseStatusSummary response={response} responseError={responseError} />
        </div>
      </div>

      {section === 'headers' ? (
        responseHeaderRows.length > 0 ? (
          <div className="mt-3 min-h-0 flex-1 overflow-auto">
            <table className="w-full table-fixed border-collapse text-sm">
              <tbody>
                {responseHeaderRows.map(row => (
                  <tr key={row.id} className="align-top">
                    <td className="w-[42%] py-1.5 pr-4 text-base-content/55">{row.key}</td>
                    <td className="break-words py-1.5 text-base-content">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 text-sm text-base-content/50">{headersDescription}</div>
        )
      ) : viewMode === 'visualizer' && canRenderVisualizer && response ? (
        <div className="h-full min-h-0 flex-1 overflow-hidden pt-3">
          <ResponseVisualizerPreview
            source={responseVisualizer}
            response={response}
            contentType={contentType}
            requestDraft={requestDraft}
            environments={environments}
          />
        </div>
      ) : viewMode === 'visualizer' && hasResponseVisualizer ? (
        <div className="mt-2 text-sm text-base-content/50">Send the request to render the response visualizer.</div>
      ) : viewMode === 'table' ? (
        <div className="min-h-0 flex-1 overflow-hidden pt-3">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <label className="flex shrink-0 flex-col gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/45">
                Table Accessor
              </span>
              <input
                type="text"
                value={responseTableAccessor}
                onChange={event => onUpdateResponseTableAccessor(event.target.value)}
                placeholder={tableResolution.detectedAccessor ?? 'Auto detect or use r.items[0].children'}
                className="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content outline-none transition placeholder:text-base-content/30 focus:border-base-content/20"
              />
            </label>

            {tableResolution.rows.length > 0 ? (
              <ResponseTable rows={tableResolution.rows} />
            ) : rawBody.trim() && !parsedStructuredResponse ? (
              <div className="rounded-xl border border-warning/20 bg-warning/8 px-4 py-3 text-sm text-warning-content/90">
                Table view only supports JSON or XML responses. Switch to Raw for this response.
              </div>
            ) : value ? (
              <div className="h-full min-h-0 flex-1 overflow-hidden">
                <CodeEditor
                  value={value}
                  language={language}
                  readOnly
                  showFoldGutter={supportsCollapsing}
                  size="small"
                  className="h-full border-0"
                  hideFocusOutline
                  onChange={readOnlyCodeEditorOnChange}
                  compact
                />
              </div>
            ) : (
              <div className="mt-2 text-sm text-base-content/50">{description}</div>
            )}
          </div>
        </div>
      ) : value ? (
        <div className="h-full min-h-0 flex-1 overflow-hidden">
          <CodeEditor
            value={displayedRawBody}
            language={language}
            readOnly
            showFoldGutter={supportsCollapsing}
            size="small"
            className="h-full border-0"
            hideFocusOutline
            onChange={readOnlyCodeEditorOnChange}
            compact
          />
        </div>
      ) : (
        <div className="mt-2 text-sm text-base-content/50">{description}</div>
      )}
    </div>
  )
})

function ResponseTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = useMemo(() => {
    const columnSet = new Set<string>()
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        columnSet.add(key)
      }
    }

    return Array.from(columnSet)
  }, [rows])

  if (rows.length === 0 || columns.length === 0) {
    return null
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-base-content/10 bg-base-100/70">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-base-200/80 backdrop-blur">
          <tr>
            {columns.map(column => (
              <th
                key={column}
                className="border-b border-base-content/10 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={String(row.id ?? row.key ?? rowIndex)} className="align-top odd:bg-base-100/35">
              {columns.map(column => (
                <td
                  key={`${rowIndex}-${column}`}
                  className="border-b border-base-content/8 px-3 py-2 text-base-content last:border-b-base-content/10"
                >
                  <span className="break-words whitespace-pre-wrap">{formatResponseTableValue(row[column])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SseResponsePanel({
  stream,
  response,
  responseError,
  requestId,
  requestName,
  requestHistoryCount,
  events,
  onSaveAsExample,
}: {
  stream: HttpSseStreamState | null
  response: SendRequestResponse | null
  responseError: string | null
  requestId: string | null
  requestName: string
  requestHistoryCount: number | null
  events: SseEventRecord[]
  onSaveAsExample?: () => void
}) {
  const headerContentType = getResponseContentType(stream?.headers ?? response?.headers ?? '')
  const durationMs = stream?.durationMs ?? response?.durationMs ?? null
  const status = stream?.status ?? response?.status ?? null
  const statusText = stream?.statusText ?? response?.statusText ?? ''
  const statusTone = getStatusTone(status ?? undefined)
  const [viewMode, setViewMode] = useState<'rows' | 'raw'>('rows')
  const rawBody = stream?.body ?? response?.body ?? ''
  const historyButtonLabel =
    requestHistoryCount === null ? 'Loading History...' : requestHistoryCount > 0 ? `Show History (${requestHistoryCount})` : 'No History'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100/35 p-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="text-sm font-medium text-base-content">SSE Events</div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-base-content/45">
          <button
            type="button"
            className="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-[11px] font-semibold text-base-content/70 transition hover:border-base-content/20 hover:text-base-content disabled:cursor-default disabled:opacity-45"
            onClick={() => {
              if (!requestId || !requestHistoryCount) {
                return
              }

              dialogActions.open({
                component: RequestHistoryDialog,
                props: { requestId, requestName },
              })
            }}
            disabled={!requestId || requestHistoryCount === null || requestHistoryCount === 0}
          >
            {historyButtonLabel}
          </button>
          <button
            type="button"
            className="rounded-lg bg-base-100/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
            onClick={() => void copyTextToClipboard(rawBody, 'Response body copied to clipboard.')}
            title="Copy Response Body"
            aria-label="Copy response body"
          >
            <CopyIcon className="h-4 w-4" />
          </button>
          {onSaveAsExample ? (
            <button
              type="button"
              className="rounded-lg bg-base-100/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
              onClick={onSaveAsExample}
              title="Save as Example"
            >
              <SaveIcon className="h-4 w-4" />
            </button>
          ) : null}
          {headerContentType ? <span>{headerContentType}</span> : null}
          <span>{events.length} events</span>
          {durationMs !== null ? <span>{durationMs} ms</span> : null}
          {status !== null ? (
            <span className={`font-semibold ${statusTone.className}`}>
              {status} {statusText}
            </span>
          ) : null}
          {stream ? <span>{stream.state}</span> : null}
          {responseError ? <span className="text-error">{responseError}</span> : null}
          <div className="ml-1 inline-flex overflow-hidden rounded-lg border border-base-content/10 bg-base-100/70">
            <button
              type="button"
              className={[
                'px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
                viewMode === 'rows' ? 'bg-base-200/80 text-base-content' : 'text-base-content/55 hover:text-base-content',
              ].join(' ')}
              onClick={() => setViewMode('rows')}
            >
              Rows
            </button>
            <button
              type="button"
              className={[
                'border-l border-base-content/10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
                viewMode === 'raw' ? 'bg-base-200/80 text-base-content' : 'text-base-content/55 hover:text-base-content',
              ].join(' ')}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
        {viewMode === 'rows' ? (
          <SseTranscript
            events={events}
            emptyMessage={stream ? 'Waiting for SSE events.' : 'Response events will appear here.'}
            showTimestamps={Boolean(stream)}
          />
        ) : rawBody ? (
          <CodeEditor
            value={rawBody}
            language="plain"
            readOnly
            size="small"
            className="h-full border-0"
            hideFocusOutline
            onChange={readOnlyCodeEditorOnChange}
            compact
          />
        ) : (
          <div className="mt-2 text-sm text-base-content/50">Raw SSE body will appear here.</div>
        )}
      </div>
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
    return <div className="max-w-[420px] whitespace-pre-wrap break-words text-right text-sm text-error">{responseError}</div>
  }

  if (!response) {
    return null
  }

  return (
    <div className="flex items-center gap-2">
      <div className="text-xs text-base-content/45">{response.durationMs} ms</div>
      <div className={`text-sm font-semibold ${statusTone.className}`}>
        {response.status} {response.statusText}
      </div>
    </div>
  )
}

async function copyTextToClipboard(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.show({ severity: 'success', message: successMessage })
  } catch {
    toast.show({ severity: 'error', message: 'Could not write the response body to the clipboard.' })
  }
}

function getByteLength(value: string) {
  return new TextEncoder().encode(value).length
}

function formatResponseBody(body: string, headers: string) {
  if (!body.trim()) return ''

  const contentType = getResponseContentType(headers)?.toLowerCase()

  const looksHtml = contentType?.includes('html') || /^\s*<!doctype html|^\s*<html/i.test(body.trim())
  if (looksHtml) {
    try {
      return formatHtml(body)
    } catch {
      return body
    }
  }

  const looksJson = contentType?.includes('json') || /^[\[{]/.test(body.trim())
  if (looksJson) {
    try {
      return formatJson(body)
    } catch {
      return body
    }
  }

  const looksXml = contentType?.includes('xml') || /^\s*<\?xml|^\s*<[a-zA-Z]/.test(body.trim())
  if (looksXml) {
    try {
      return formatXml(body)
    } catch {
      return body
    }
  }

  return body
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function formatXml(xml: string): string {
  let formatted = ''
  let indent = 0
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isClosing = trimmed.startsWith('</')
    const isSelfClosing = trimmed.endsWith('/>') || trimmed.startsWith('<?')
    const isOpening = trimmed.startsWith('<') && !isClosing && !isSelfClosing

    if (isClosing) {
      indent = Math.max(0, indent - 1)
    }

    formatted += '  '.repeat(indent) + trimmed + '\n'

    if (isOpening) {
      indent++
    }
  }

  return formatted.trim()
}

function formatHtml(html: string): string {
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')
  const doctype = documentNode.doctype
  const doctypeText = doctype
    ? `<!DOCTYPE ${doctype.name}${doctype.publicId ? ` PUBLIC \"${doctype.publicId}\"` : ''}${doctype.systemId ? ` \"${doctype.systemId}\"` : ''}>\n`
    : ''
  return `${doctypeText}${formatMarkup(documentNode.documentElement.outerHTML)}`.trim()
}

function formatMarkup(markup: string): string {
  let formatted = ''
  let indent = 0
  const lines = markup.replace(/>\s*</g, '>\n<').split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const isClosing = /^<\//.test(trimmed)
    const isSelfClosing = /\/>$/.test(trimmed) || /^<!/.test(trimmed) || /^<meta\b/i.test(trimmed) || /^<link\b/i.test(trimmed) || /^<img\b/i.test(trimmed) || /^<input\b/i.test(trimmed) || /^<br\b/i.test(trimmed) || /^<hr\b/i.test(trimmed)
    const isInlineTextNode = /^(?!<).+/.test(trimmed)
    const isOpening = /^<[^/!][^>]*>$/.test(trimmed) && !isSelfClosing && !trimmed.includes('</')

    if (isClosing) {
      indent = Math.max(0, indent - 1)
    }

    formatted += `${'  '.repeat(Math.max(0, indent - (isInlineTextNode ? 0 : 0)))}${trimmed}\n`

    if (isOpening) {
      indent += 1
    }
  }

  return formatted.trim()
}

function parseStructuredResponse(body: string, contentType: string | null): ParsedStructuredResponse | null {
  if (!body.trim()) {
    return null
  }

  const language = detectResponseLanguage(contentType, body)

  if (language === 'json') {
    try {
      return { format: 'json', root: JSON.parse(body) }
    } catch {
      return null
    }
  }

  if (language === 'xml') {
    return parseXmlToStructuredResponse(body)
  }

  return null
}

type ParsedStructuredResponse = {
  format: 'json' | 'xml'
  root: unknown
}

type ResponseTableResolution = {
  isAvailable: boolean
  rows: Array<Record<string, unknown>>
  detectedAccessor: string | null
}

function parseXmlToStructuredResponse(xml: string): ParsedStructuredResponse | null {
  try {
    const parser = new DOMParser()
    const documentNode = parser.parseFromString(xml, 'application/xml')
    const parseError = documentNode.querySelector('parsererror')
    if (parseError) {
      return null
    }

    const rootElement = documentNode.documentElement
    if (!rootElement) {
      return null
    }

    return {
      format: 'xml',
      root: {
        [rootElement.nodeName]: xmlElementToJson(rootElement),
      },
    }
  } catch {
    return null
  }
}

function xmlElementToJson(element: Element): unknown {
  const attributes = Object.fromEntries(
    Array.from(element.attributes).map(attribute => [`@${attribute.name}`, attribute.value])
  )
  const childElements = Array.from(element.children)
  const textValue = element.textContent?.trim() ?? ''

  if (childElements.length === 0) {
    if (Object.keys(attributes).length === 0) {
      return textValue
    }

    return textValue ? { ...attributes, '#text': textValue } : attributes
  }

  const children: Record<string, unknown> = { ...attributes }

  for (const child of childElements) {
    const nextValue = xmlElementToJson(child)
    const existingValue = children[child.nodeName]

    if (existingValue === undefined) {
      children[child.nodeName] = nextValue
      continue
    }

    children[child.nodeName] = Array.isArray(existingValue) ? [...existingValue, nextValue] : [existingValue, nextValue]
  }

  const directTextNodes = Array.from(element.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent?.trim() ?? '')
    .filter(Boolean)

  if (directTextNodes.length > 0) {
    children['#text'] = directTextNodes.join(' ')
  }

  return children
}

function resolveResponseTableRows(
  parsedStructuredResponse: ParsedStructuredResponse | null,
  accessor: string
): ResponseTableResolution {
  if (!parsedStructuredResponse) {
    return { isAvailable: false, rows: [], detectedAccessor: null }
  }

  const detectedMatch = findFirstObjectArray(parsedStructuredResponse.root)
  const candidate = accessor.trim()
    ? resolveAccessor(parsedStructuredResponse.root, accessor.trim())
    : detectedMatch?.value
  const rows = normalizeResponseTableRows(candidate)

  return {
    isAvailable: true,
    rows,
    detectedAccessor: detectedMatch?.path ?? null,
  }
}

function resolveAccessor(root: unknown, accessor: string): unknown {
  const segments = parseAccessorSegments(accessor)
  if (segments === null) {
    return undefined
  }

  let current: unknown = root

  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return undefined
      }

      current = current[segment]
      continue
    }

    if (!isRecordLike(current) || !(segment in current)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function parseAccessorSegments(accessor: string): Array<string | number> | null {
  const trimmed = accessor.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed === 'r') {
    return []
  }

  if (!trimmed.startsWith('r')) {
    return null
  }

  const segments: Array<string | number> = []
  let index = 1

  while (index < trimmed.length) {
    const currentChar = trimmed[index]

    if (currentChar === '.') {
      index += 1
      const start = index
      while (index < trimmed.length && /[A-Za-z0-9_$-]/.test(trimmed[index] ?? '')) {
        index += 1
      }

      if (start === index) {
        return null
      }

      segments.push(trimmed.slice(start, index))
      continue
    }

    if (currentChar === '[') {
      const closingIndex = trimmed.indexOf(']', index)
      if (closingIndex < 0) {
        return null
      }

      const innerValue = trimmed.slice(index + 1, closingIndex).trim()
      if (/^\d+$/.test(innerValue)) {
        segments.push(Number(innerValue))
      } else {
        const quotedMatch = innerValue.match(/^(['"])(.*)\1$/)
        if (!quotedMatch) {
          return null
        }

        segments.push(quotedMatch[2])
      }

      index = closingIndex + 1
      continue
    }

    return null
  }

  return segments
}

function findFirstObjectArray(root: unknown): { path: string; value: unknown } | null {
  const queue: Array<{ value: unknown; path: string }> = [{ value: root, path: 'r' }]
  const visited = new Set<unknown>()

  while (queue.length > 0) {
    const currentEntry = queue.shift()
    const current = currentEntry?.value

    if (!currentEntry || current == null || visited.has(current)) {
      continue
    }

    if (typeof current === 'object') {
      visited.add(current)
    }

    if (Array.isArray(current) && current.length > 0 && current.every(isRecordLike)) {
      return currentEntry
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        queue.push({ value: item, path: `${currentEntry.path}[${index}]` })
      })
      continue
    }

    if (isRecordLike(current)) {
      Object.entries(current).forEach(([key, value]) => {
        queue.push({ value, path: `${currentEntry.path}${formatAccessorSegment(key)}` })
      })
    }
  }

  return null
}

function formatAccessorSegment(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

function normalizeResponseTableRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecordLike)
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatResponseTableValue(value: unknown) {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function getResponseContentType(headers: string) {
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

function detectResponseLanguage(contentType: string | null, body: string): CodeEditorLanguage {
  const normalizedContentType = contentType?.toLowerCase() ?? ''

  if (normalizedContentType.includes('json')) {
    return 'json'
  }

  if (normalizedContentType.includes('html')) {
    return 'html'
  }

  if (normalizedContentType.includes('xml')) {
    return 'xml'
  }

  if (normalizedContentType.includes('javascript') || normalizedContentType.includes('ecmascript')) {
    return 'javascript'
  }

  if (normalizedContentType.includes('css')) {
    return 'css'
  }

  const trimmedBody = body.trim()
  if (trimmedBody.startsWith('<!DOCTYPE') || trimmedBody.startsWith('<html')) {
    return 'html'
  }

  if (trimmedBody.startsWith('<?xml') || trimmedBody.startsWith('<')) {
    return 'xml'
  }

  if (/^[\[{]/.test(trimmedBody)) {
    return 'json'
  }

  return 'plain'
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

const EMPTY_SCRIPT_ERRORS: RequestScriptError[] = []
