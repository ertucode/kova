import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { type Extension } from '@codemirror/state'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  CopyIcon,
  SaveIcon,
  XCircleIcon,
} from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES, type AppSettingsResponseBodyDisplayMode } from '@common/AppSettings'
import type { ScriptPackageArtifact } from '@common/ScriptPackages'
import type { SharedScriptRecord } from '@common/SharedScripts'
import { getSseEventDisplayName, isSseContentType, parseSseEvents } from '@common/Sse'
import type {
  HttpSseStreamState,
  RequestScriptError,
  RequestTestRun,
  SendRequestResponse,
  SseEventRecord,
} from '@common/Requests'
import { formatJson } from '@common/Json5'
import { Typescript } from '@common/Typescript'
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
import { toSelectionKey } from './folderExplorerUtils'
import { requestExecutionStore } from './requestExecutionStore'
import { AppSettingsCoordinator, appSettingsStore } from '@/global/appSettingsStore'
import { Tooltip } from '../components/Tooltip'
import { formatXml } from '@common/formatXml'
import { createJsonResponsePathExtension } from './requestDetailsJsonResponsePathExtension'
import { resolveResponseTableRows, type ParsedStructuredResponse } from './requestDetailsResponseTable'
import { formatHtml } from '@common/formatHtml'
import { formatBytes } from '@common/formatBytes'
import { useHoldAction } from '@/lib/hooks/useHoldAction'
import { saveHttpResponseBodyToFile } from './saveResponseToFile'

const readOnlyCodeEditorOnChange = () => undefined
const jsonResponsePathExtension = createJsonResponsePathExtension()

export const RequestDetailsResponsePanel = memo(function RequestDetailsResponsePanel({
  isSending,
  requestName,
  requestHeaders,
  requestBody,
  requestBodyType,
  requestRawType,
  requestGraphqlQuery,
  requestGraphqlVariables,
  responseVisualizer,
  responseTableAccessor,
  preferredResponseBodyView,
  visualizerRequestDraft,
  onJumpToScriptError,
  visualizerEnvironments,
  sharedScripts,
  scriptPackageArtifacts,
}: {
  isSending: boolean
  requestName: string
  requestHeaders: string
  requestBody: string
  requestBodyType: RequestDetailsDraft['bodyType']
  requestRawType: RequestDetailsDraft['rawType']
  requestGraphqlQuery: RequestDetailsDraft['graphqlQuery']
  requestGraphqlVariables: RequestDetailsDraft['graphqlVariables']
  responseVisualizer: string
  responseTableAccessor: string
  preferredResponseBodyView: RequestDetailsDraft['preferredResponseBodyView']
  visualizerRequestDraft: Pick<
    RequestDetailsDraft,
    'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType'
  >
  onJumpToScriptError: (error: RequestScriptError) => void
  visualizerEnvironments: Array<{
    id: string
    name: string
    isActive: boolean
    priority: number
    createdAt: number
    values: Record<string, string>
  }>
  sharedScripts: SharedScriptRecord[]
  scriptPackageArtifacts: ScriptPackageArtifact[]
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
  const responseContentType = useMemo(() => getResponseContentType(response?.headers ?? ''), [response?.headers])
  const sseStreamContentType = useMemo(() => getResponseContentType(sseStream?.headers ?? ''), [sseStream?.headers])
  const responseSseEvents = useMemo(
    () => (response && isSseContentType(responseContentType) ? parseSseEvents(response.body) : []),
    [response, responseContentType]
  )
  const displayedSseEvents = sseStream?.events.length ? sseStream.events : responseSseEvents
  const shouldShowSsePanel = isSseContentType(sseStreamContentType) || isSseContentType(responseContentType)
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
      name: `${requestName} ${responseSource.status || responseSource.statusText}`,
      requestHeaders,
      requestBody,
      requestBodyType,
      requestRawType,
      graphqlQuery: requestGraphqlQuery,
      graphqlVariables: requestGraphqlVariables,
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
    toast.show({ severity: 'success', title: 'Example saved', message: `Saved response example for ${requestName}.` })
  }, [
    requestBody,
    requestBodyType,
    requestHeaders,
    requestName,
    requestRawType,
    requestGraphqlQuery,
    requestGraphqlVariables,
    response,
    selectedRequestId,
    sseStream,
  ])

  const saveCurrentResponseToFile = useCallback(async () => {
    const responseSource = response
      ? {
          headers: response.headers,
          body: response.body,
        }
      : sseStream && sseStream.body.trim()
        ? {
            headers: sseStream.headers,
            body: sseStream.body,
          }
        : null

    if (!responseSource) {
      return
    }

    await saveHttpResponseBodyToFile({
      requestName,
      headers: responseSource.headers,
      body: responseSource.body,
    })
  }, [requestName, response, sseStream])

  const updateResponseTableAccessor = useCallback((value: string) => {
    const { selected, entries } = folderExplorerEditorStore.getSnapshot().context
    if (!selected) {
      return
    }

    const currentDraft = entries[toSelectionKey(selected)]?.current
    if (currentDraft?.itemType !== 'request') {
      return
    }

    FolderExplorerCoordinator.updateSelectedDraft({ ...currentDraft, responseTableAccessor: value })
  }, [])

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
  }, [
    selectedRequestId,
    isSending,
    response?.execution.response?.receivedAt,
    responseError,
    scriptErrors.length,
    sseStream?.state,
  ])

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
    <section className="relative shrink-0 overflow-hidden bg-base-100/95" style={{ height: `${responsePaneHeight}px` }}>
      <button
        type="button"
        className={`block h-[3px] w-full cursor-ns-resize border-0 transition-colors ${
          isResizingResponsePane ? 'bg-base-content/35' : 'bg-base-content/10 hover:bg-base-content/25'
        } `}
        onPointerDown={startResize}
        aria-label="Resize response panel"
        title="Resize response panel"
      />

      <div className="relative flex h-[calc(100%-3px)] min-h-0 flex-col overflow-hidden">
        {isSending ? (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px overflow-hidden bg-base-content/8">
              <div className="h-full w-1/3 animate-[request-loading_1.25s_ease-in-out_infinite] rounded-full bg-info/80 shadow-[0_0_18px_rgba(59,130,246,0.4)]" />
            </div>
          </>
        ) : null}
        <ResponseScriptErrors responseError={responseError} errors={scriptErrors} onJumpToError={onJumpToScriptError} />
        <div
          className={`flex min-h-0 flex-1 overflow-hidden transition duration-200 ${
            isSending && !shouldShowSsePanel ? 'pointer-events-none blur-[1.5px] saturate-50 opacity-60' : ''
          }`}
        >
          {shouldShowSsePanel ? (
            <SseResponsePanel
              stream={sseStream}
              response={response}
              requestId={selectedRequestId}
              requestName={requestName}
              requestHistoryCount={requestHistoryCount}
              events={displayedSseEvents}
              onSaveAsExample={
                response || (sseStream && sseStream.body.trim()) ? () => void saveCurrentResponseAsExample() : undefined
              }
              onSaveToFile={response || (sseStream && sseStream.body.trim()) ? () => void saveCurrentResponseToFile() : undefined}
            />
          ) : (
            <>
              <ResponseBodyPanel
                value={formattedResponseBody}
                rawBody={response?.body ?? ''}
                headers={response?.headers ?? ''}
                requestId={selectedRequestId}
                requestName={requestName}
                requestHistoryCount={requestHistoryCount}
                description="Response body will appear here."
                headersDescription="Response headers will appear here."
                contentType={responseContentType}
                responseVisualizer={responseVisualizer}
                responseTableAccessor={responseTableAccessor}
                preferredResponseBodyView={preferredResponseBodyView}
                responseBodyDisplayMode={responseBodyDisplayMode}
                requestSelection={responseBodyRequestSelection}
                requestDraft={visualizerRequestDraft}
                sharedScripts={sharedScripts}
                scriptPackageArtifacts={scriptPackageArtifacts}
                onUpdateResponseTableAccessor={updateResponseTableAccessor}
                onUpdateResponseBodyDisplayMode={AppSettingsCoordinator.saveResponseBodyDisplayMode}
                environments={visualizerEnvironments}
                response={response}
                testRun={response?.testRun ?? null}
                onJumpToScriptError={onJumpToScriptError}
                onSaveAsExample={response ? () => void saveCurrentResponseAsExample() : undefined}
                onSaveToFile={response ? () => void saveCurrentResponseToFile() : undefined}
              />
            </>
          )}
        </div>
      </div>
    </section>
  )
})

const ResponseScriptErrors = memo(function ResponseScriptErrors({
  responseError,
  errors,
  onJumpToError,
}: {
  responseError: string | null
  errors: RequestScriptError[]
  onJumpToError: (error: RequestScriptError) => void
}) {
  if (!responseError && errors.length === 0) {
    return null
  }

  return (
    <div className="group relative block">
      <div className="border-b border-error/18 bg-error/6 text-sm text-base-content/82 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-error)_10%,transparent)]">
        {responseError ? (
          <div className="block w-full border-b border-error/10 px-3 py-2 text-left last:border-b-0">
            <span className="font-medium text-error">Request Error</span> <span>{responseError}</span>
          </div>
        ) : null}
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
            Error Details
          </div>
          <div className="max-h-[24rem] overflow-auto p-3">
            {responseError ? (
              <div className="border-b border-base-content/10 px-1 py-2 last:border-b-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-error">Request Error</span>
                </div>
                <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-base-content/72">
                  {responseError}
                </div>
              </div>
            ) : null}
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

type PersistedResponseBodyViewMode = RequestDetailsDraft['preferredResponseBodyView']
type ResponseBodyPanelViewMode = PersistedResponseBodyViewMode | 'preview' | 'render-html'
type ResponseHeaderRow = { id: string; key: string; value: string }
type ResponseBodyContentState =
  | { kind: 'message'; message: string }
  | { kind: 'image'; source: string; alt: string }
  | { kind: 'pdf'; source: string; title: string }
  | { kind: 'html'; source: string; title: string }
  | {
      kind: 'visualizer'
      source: string
      response: SendRequestResponse
      contentType: string | null
      requestDraft: Pick<
        RequestDetailsDraft,
        'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType'
      >
      environments: Array<{
        id: string
        name: string
        isActive: boolean
        priority: number
        createdAt: number
        values: Record<string, string>
      }>
      sharedScripts: SharedScriptRecord[]
    }
  | {
      kind: 'table'
      rows: Array<Record<string, unknown>>
      itemCount: number
      accessor: string
      placeholder: string
      fallbackBody: string
      language: CodeEditorLanguage
      supportsCollapsing: boolean
      supportsStructuredResponse: boolean
      emptyMessage: string
    }
  | {
      kind: 'editor'
      value: string
      language: CodeEditorLanguage
      supportsCollapsing: boolean
      extensions?: Extension[]
    }

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
  sharedScripts,
  scriptPackageArtifacts,
  response,
  testRun,
  onJumpToScriptError,
  onSaveAsExample,
  onSaveToFile,
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
  requestDraft: Pick<
    RequestDetailsDraft,
    'method' | 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType' | 'rawType'
  >
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
  sharedScripts: SharedScriptRecord[]
  scriptPackageArtifacts: ScriptPackageArtifact[]
  response: SendRequestResponse | null
  testRun: RequestTestRun | null
  onJumpToScriptError: (error: RequestScriptError) => void
  onSaveAsExample?: () => void
  onSaveToFile?: () => void
}) {
  const language = detectResponseLanguage(contentType, rawBody)
  const isImageResponse = isImageContentType(contentType)
  const isPdfResponse = isPdfContentType(contentType)
  const imageSource = useMemo(() => getResponseImageSource(rawBody, contentType), [contentType, rawBody])
  const pdfSource = useMemo(() => getResponsePdfSource(rawBody, contentType), [contentType, rawBody])
  const hasMediaPreview = (isImageResponse && imageSource !== null) || (isPdfResponse && pdfSource !== null)
  const supportsHtmlRender = isRenderableHtmlContentType(contentType)
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
  const [viewMode, setViewMode] = useState<ResponseBodyPanelViewMode>(preferredResponseBodyView)
  const [section, setSection] = useState<'body' | 'headers' | 'tests'>('body')
  const bodyViewResetKeyRef = useRef<string | null>(null)
  const testsText = useMemo(() => formatTestRunDetails(testRun), [testRun])
  const saveAsExampleButtonProps = useHoldAction({
    onClick: onSaveAsExample ?? (() => undefined),
    onHold: onSaveToFile ?? (() => undefined),
    disabled: !onSaveAsExample || !onSaveToFile,
  })
  const canCopyResponseSection =
    section === 'body'
      ? displayedRawBody.trim().length > 0
      : section === 'headers'
        ? responseHeaderRows.length > 0
        : testsText.trim().length > 0
  const historyButtonLabel =
    requestHistoryCount === null
      ? 'Loading History...'
      : requestHistoryCount > 0
        ? `Show History (${requestHistoryCount})`
        : 'No History'
  const displayModeOptions = useMemo(
    () =>
      APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.map(mode => ({
        value: mode,
        label: mode === 'raw' ? 'Original' : 'Formatted',
      })),
    []
  )
  const viewModeOptions = useMemo(
    () => getResponseBodyViewOptions({ hasMediaPreview, supportsHtmlRender }),
    [hasMediaPreview, supportsHtmlRender]
  )
  const availableViewModes = useMemo(() => viewModeOptions.map(option => option.value), [viewModeOptions])
  const responseBodyEditorExtensions = useMemo(
    () => (language === 'json' ? [jsonResponsePathExtension] : undefined),
    [language]
  )

  useEffect(() => {
    const nextBodyViewResetKey = `${contentType ?? ''}:${rawBody}`
    const isNewBody = nextBodyViewResetKey !== bodyViewResetKeyRef.current
    const fallbackViewMode = availableViewModes.includes(preferredResponseBodyView)
      ? preferredResponseBodyView
      : (availableViewModes[0] ?? 'raw')

    if (isNewBody) {
      bodyViewResetKeyRef.current = nextBodyViewResetKey
      setViewMode(hasMediaPreview ? 'preview' : fallbackViewMode)
      return
    }

    if (!availableViewModes.includes(viewMode)) {
      setViewMode(fallbackViewMode)
      return
    }

    if (
      availableViewModes.includes(preferredResponseBodyView) &&
      isPersistedResponseBodyViewMode(viewMode) &&
      viewMode !== preferredResponseBodyView
    ) {
      setViewMode(preferredResponseBodyView)
    }
  }, [availableViewModes, contentType, hasMediaPreview, preferredResponseBodyView, rawBody, viewMode])

  const updatePreferredResponseBodyView = async (nextView: PersistedResponseBodyViewMode) => {
    if (!requestSelection) {
      return false
    }

    return await FolderExplorerCoordinator.updateRequestResponseBodyViewPreference(requestSelection, nextView)
  }

  const bodyContentState = useMemo<ResponseBodyContentState>(() => {
    if (viewMode === 'preview') {
      if (isImageResponse && imageSource) {
        return { kind: 'image', source: imageSource, alt: contentType ?? 'Response image' }
      }

      if (isPdfResponse && pdfSource) {
        return { kind: 'pdf', source: pdfSource, title: contentType ?? 'Response PDF' }
      }

      if (isPdfResponse) {
        return { kind: 'message', message: 'PDF response could not be previewed.' }
      }

      if (isImageResponse) {
        return { kind: 'message', message: 'Image response could not be previewed.' }
      }
    }

    if (viewMode === 'render-html') {
      return supportsHtmlRender
        ? { kind: 'html', source: rawBody, title: contentType ?? 'Response HTML' }
        : { kind: 'message', message: 'HTML render is not available for this response.' }
    }

    if (viewMode === 'visualizer') {
      if (canRenderVisualizer && response) {
        return {
          kind: 'visualizer',
          source: responseVisualizer,
          response,
          contentType,
          requestDraft,
          environments,
          sharedScripts,
        }
      }

      if (hasResponseVisualizer) {
        return { kind: 'message', message: 'Send the request to render the response visualizer.' }
      }
    }

    if (viewMode === 'table') {
      return {
        kind: 'table',
        rows: tableResolution.rows,
        itemCount: tableResolution.rows.length,
        accessor: responseTableAccessor,
        placeholder: tableResolution.detectedAccessor ?? 'Auto detect or use r.items[0].children',
        fallbackBody: value,
        language,
        supportsCollapsing,
        supportsStructuredResponse: parsedStructuredResponse !== null,
        emptyMessage: description,
      }
    }

    if (value) {
      return {
        kind: 'editor',
        value: displayedRawBody,
        language,
        supportsCollapsing,
        extensions: responseBodyEditorExtensions,
      }
    }

    return { kind: 'message', message: description }
  }, [
    canRenderVisualizer,
    contentType,
    description,
    displayedRawBody,
    environments,
    sharedScripts,
    hasResponseVisualizer,
    imageSource,
    isImageResponse,
    isPdfResponse,
    language,
    parsedStructuredResponse,
    pdfSource,
    requestDraft,
    response,
    responseBodyEditorExtensions,
    responseTableAccessor,
    responseVisualizer,
    rawBody,
    supportsCollapsing,
    supportsHtmlRender,
    tableResolution.detectedAccessor,
    tableResolution.rows,
    value,
    viewMode,
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100/35 p-2">
      <div className="flex shrink-0 items-center justify-between gap-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="mr-1 text-sm font-medium text-base-content">Response</div>
          <div className="inline-flex overflow-hidden rounded-lg border border-base-content/10 bg-base-100/70">
            {[
              { value: 'body' as const, label: 'Body' },
              { value: 'headers' as const, label: 'Headers' },
              { value: 'tests' as const, label: 'Tests' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                className={[
                  'px-3 py-2 text-[11px] font-semibold transition',
                  section === option.value
                    ? 'bg-base-200/80 text-base-content'
                    : 'text-base-content/60 hover:text-base-content',
                  option.value !== 'body' ? 'border-l border-base-content/10' : '',
                ].join(' ')}
                onClick={() => setSection(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {section === 'body' ? (
            <LabeledSelect
              label="View"
              value={viewMode}
              options={viewModeOptions}
              className="w-[102px]"
              onChange={nextView => {
                if (!isPersistedResponseBodyViewMode(nextView)) {
                  setViewMode(nextView)
                  return
                }

                void updatePreferredResponseBodyView(nextView).then(success => {
                  if (success) {
                    setViewMode(nextView)
                  }
                })
              }}
            />
          ) : null}
          {section === 'body' && viewMode === 'raw' && hasFormattedBody ? (
            <LabeledSelect
              label="Format"
              value={responseBodyDisplayMode}
              options={displayModeOptions}
              className="w-[102px]"
              onChange={mode => {
                void onUpdateResponseBodyDisplayMode(mode)
              }}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canCopyResponseSection ? (
            <Tooltip
              content={
                section === 'body'
                  ? 'Copy Response Body'
                  : section === 'headers'
                    ? 'Copy Response Headers'
                    : 'Copy Test Results'
              }
              placement="top"
              className="flex"
            >
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-100/70 text-base-content/65 transition hover:text-base-content"
                onClick={() =>
                  void copyTextToClipboard(
                    section === 'body' ? displayedRawBody : section === 'headers' ? headers : testsText,
                    section === 'body'
                      ? 'Response body copied to clipboard.'
                      : section === 'headers'
                        ? 'Response headers copied to clipboard.'
                        : 'Test results copied to clipboard.'
                  )
                }
                aria-label={
                  section === 'body'
                    ? 'Copy response body'
                    : section === 'headers'
                      ? 'Copy response headers'
                      : 'Copy test results'
                }
              >
                <CopyIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
          {section === 'body' && onSaveAsExample ? (
            <Tooltip content="Save as Example (Hold to Save to File)" placement="top" className="flex">
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-100/70 text-base-content/65 transition hover:text-base-content"
                aria-label="Save as example. Hold to save to file"
                {...saveAsExampleButtonProps}
              >
                <SaveIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          ) : null}
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
          {contentType ? <span className="truncate text-xs text-base-content/45">{contentType}</span> : null}
          {response ? <span className="shrink-0 text-xs text-base-content/45">{responseBodySize}</span> : null}
          <ResponseStatusSummary response={response} />
        </div>
      </div>

      {section === 'headers'
        ? renderResponseHeaders(responseHeaderRows, headersDescription)
        : section === 'tests'
          ? renderResponseTests(testRun, onJumpToScriptError)
          : renderResponseBodyContent(bodyContentState, onUpdateResponseTableAccessor, scriptPackageArtifacts)}
    </div>
  )
})

function renderResponseHeaders(rows: ResponseHeaderRow[], emptyMessage: string) {
  if (rows.length === 0) {
    return <div className="mt-2 text-sm text-base-content/50">{emptyMessage}</div>
  }

  return (
    <div className="mt-3 min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <tbody>
          {rows.map(row => (
            <tr key={row.id} className="align-top">
              <td className="w-[42%] py-1.5 pr-4 text-base-content/55">{row.key}</td>
              <td className="break-words py-1.5 text-base-content">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderResponseTests(testRun: RequestTestRun | null, onJumpToScriptError: (error: RequestScriptError) => void) {
  if (!testRun) {
    return <div className="mt-2 text-sm text-base-content/50">Test results will appear here.</div>
  }

  return <ResponseTestsPanel testRun={testRun} onJumpToScriptError={onJumpToScriptError} />
}

function renderResponseBodyContent(
  state: ResponseBodyContentState,
  onUpdateResponseTableAccessor: (value: string) => void,
  scriptPackageArtifacts: ScriptPackageArtifact[]
) {
  if (state.kind === 'message') {
    return <div className="mt-2 text-sm text-base-content/50">{state.message}</div>
  }

  if (state.kind === 'image') {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <img
          src={state.source}
          alt={state.alt}
          className="max-h-full max-w-full rounded-lg border border-base-content/10 bg-base-100/70 object-contain shadow-sm"
        />
      </div>
    )
  }

  if (state.kind === 'pdf') {
    return (
      <div className="h-full min-h-0 flex-1 overflow-hidden pt-3">
        <iframe
          src={state.source}
          title={state.title}
          className="h-full w-full rounded-lg border border-base-content/10 bg-base-100/70"
        />
      </div>
    )
  }

  if (state.kind === 'html') {
    return (
      <div className="h-full min-h-0 flex-1 overflow-hidden pt-3">
        <iframe
          srcDoc={state.source}
          title={state.title}
          sandbox=""
          className="h-full w-full rounded-lg border border-base-content/10 bg-white"
        />
      </div>
    )
  }

  if (state.kind === 'visualizer') {
    return (
      <div className="h-full min-h-0 flex-1 overflow-hidden pt-3">
        <ResponseVisualizerPreview
          source={state.source}
          response={state.response}
          contentType={state.contentType}
          requestDraft={state.requestDraft}
          environments={state.environments}
          sharedScripts={state.sharedScripts}
          scriptPackages={scriptPackageArtifacts}
        />
      </div>
    )
  }

  if (state.kind === 'table') {
    return (
      <div className="min-h-0 flex-1 overflow-hidden pt-3">
        <div className="flex h-full min-h-0 flex-col gap-3">
          <label className="flex shrink-0 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/45">
                Table Accessor
              </span>
              <span className="shrink-0 text-[11px] text-base-content/45">{state.itemCount} items</span>
            </div>
            <input
              type="text"
              value={state.accessor}
              onChange={event => onUpdateResponseTableAccessor(event.target.value)}
              placeholder={state.placeholder}
              className="h-9 rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content outline-none transition placeholder:text-base-content/30 focus:border-base-content/20"
            />
          </label>

          {state.rows.length > 0 ? (
            <ResponseTable rows={state.rows} />
          ) : state.fallbackBody.trim() && !state.supportsStructuredResponse ? (
            <div className="rounded-xl border border-warning/20 bg-warning/8 px-4 py-3 text-sm text-warning-content/90">
              Table view only supports JSON or XML responses. Switch to Raw for this response.
            </div>
          ) : state.fallbackBody ? (
            <div className="h-full min-h-0 flex-1 overflow-hidden">
              <CodeEditor
                value={state.fallbackBody}
                language={state.language}
                readOnly
                showFoldGutter={state.supportsCollapsing}
                size="small"
                className="h-full border-0"
                hideFocusOutline
                onChange={readOnlyCodeEditorOnChange}
                compact
              />
            </div>
          ) : (
            <div className="mt-2 text-sm text-base-content/50">{state.emptyMessage}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-hidden">
      <CodeEditor
        value={state.value}
        language={state.language}
        extensions={state.extensions}
        readOnly
        showFoldGutter={state.supportsCollapsing}
        size="small"
        className="h-full border-0"
        hideFocusOutline
        onChange={readOnlyCodeEditorOnChange}
        compact
      />
    </div>
  )
}

export const ResponseTestsPanel = memo(function ResponseTestsPanel({
  testRun,
  onJumpToScriptError,
}: {
  testRun: RequestTestRun
  onJumpToScriptError: (error: RequestScriptError) => void
}) {
  const statusTone = getTestStatusTone(testRun.status)

  return (
    <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
      <div className="space-y-3">
        <div className="rounded-2xl bg-base-200/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/45">Test Run</div>
              <div className={`mt-1 text-sm font-semibold ${statusTone.className}`}>{getTestRunHeading(testRun)}</div>
            </div>
            <div className="text-xs text-base-content/45">{testRun.durationMs} ms</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Total', value: testRun.totalCount, toneClassName: 'text-base-content' },
              { label: 'Passed', value: testRun.passedCount, toneClassName: 'text-success' },
              { label: 'Failed', value: testRun.failedCount, toneClassName: 'text-error' },
              { label: 'Skipped', value: testRun.skippedCount, toneClassName: 'text-warning' },
            ].map(item => (
              <div key={item.label} className="rounded-xl bg-base-100/70 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/45">
                  {item.label}
                </div>
                <div className={`mt-1 text-lg font-semibold ${item.toneClassName}`}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        {testRun.suites.length > 0 ? (
          <div className="space-y-1">
            {testRun.suites.map(suite => (
              <TestSuiteCard key={suite.id} suite={suite} depth={0} onJumpToScriptError={onJumpToScriptError} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-base-100/50 px-4 py-4 text-sm text-base-content/45">
            No test suites were reported for this run.
          </div>
        )}
      </div>
    </div>
  )
})

const TestSuiteCard = memo(function TestSuiteCard({
  suite,
  depth,
  onJumpToScriptError,
}: {
  suite: RequestTestRun['suites'][number]
  depth: number
  onJumpToScriptError: (error: RequestScriptError) => void
}) {
  const statusTone = getTestStatusTone(suite.status)
  const [expanded, setExpanded] = useState(suite.status === 'failed')
  const hasChildren = suite.tests.length > 0 || suite.suites.length > 0
  const suiteSummary = [
    `${suite.durationMs} ms`,
    `${suite.tests.length} test${suite.tests.length === 1 ? '' : 's'}`,
    suite.suites.length > 0 ? `${suite.suites.length} nested suite${suite.suites.length === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-base-200/35"
        onClick={() => {
          if (hasChildren) {
            setExpanded(current => !current)
          }
        }}
      >
        <span className="shrink-0 text-base-content/45">
          {hasChildren ? (
            expanded ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronRightIcon className="size-4" />
            )
          ) : (
            <span className="block size-4" />
          )}
        </span>
        <span className={`shrink-0 ${statusTone.className}`}>
          <TestStatusIcon status={suite.status} />
        </span>
        <div className={`min-w-0 flex-1 truncate text-sm font-semibold ${statusTone.className}`}>{suite.name}</div>
        <span className="shrink-0 text-xs text-base-content/45">{suiteSummary}</span>
      </button>

      {expanded ? (
        <div className="mt-0.5 space-y-1">
          {suite.tests.map(test => (
            <TestCaseRow key={test.id} test={test} depth={depth + 1} onJumpToScriptError={onJumpToScriptError} />
          ))}
          {suite.suites.map(childSuite => (
            <TestSuiteCard
              key={childSuite.id}
              suite={childSuite}
              depth={depth + 1}
              onJumpToScriptError={onJumpToScriptError}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const TestCaseRow = memo(function TestCaseRow({
  test,
  depth,
  onJumpToScriptError,
}: {
  test: RequestTestRun['suites'][number]['tests'][number]
  depth: number
  onJumpToScriptError: (error: RequestScriptError) => void
}) {
  const statusTone = getTestStatusTone(test.status)
  const [expanded, setExpanded] = useState(test.status === 'failed')
  const hasDetails = test.failures.length > 0
  const primaryFailure = test.failures[0]?.message.trim() ?? ''
  const testSummary = [
    `${test.durationMs} ms`,
    hasDetails ? `${test.failures.length} failure${test.failures.length === 1 ? '' : 's'}` : null,
    primaryFailure || null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div style={{ marginLeft: `${Math.min(depth, 5) * 18}px` }}>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-base-200/30"
        onClick={() => {
          if (hasDetails) {
            setExpanded(current => !current)
          }
        }}
      >
        <span className="shrink-0 text-base-content/45">
          {hasDetails ? (
            expanded ? (
              <ChevronDownIcon className="size-4" />
            ) : (
              <ChevronRightIcon className="size-4" />
            )
          ) : (
            <span className="block size-4" />
          )}
        </span>
        <span className={`shrink-0 ${statusTone.className}`}>
          <TestStatusIcon status={test.status} />
        </span>
        <div className="min-w-0 flex-1 items-baseline gap-2 text-left sm:flex">
          <span className={`block min-w-0 truncate text-sm font-medium ${statusTone.className}`}>{test.name}</span>
          <span className="block min-w-0 truncate text-xs text-base-content/45">{testSummary}</span>
        </div>
      </button>

      {expanded && hasDetails ? (
        <div className="mt-0.5 space-y-2">
          {test.failures.map((failure, index) => (
            <div key={`${test.id}-failure-${index}`} className="ml-6 rounded-xl px-2 py-0">
              {failure.line !== null || failure.sourceLine ? (
                <button
                  type="button"
                  className="mb-2 flex min-w-0 w-full items-stretch overflow-hidden rounded-lg bg-base-100/85 text-left transition hover:bg-base-100 hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                  onClick={() => {
                    if (failure.line === null) {
                      return
                    }

                    onJumpToScriptError({
                      phase: 'test',
                      sourceName: failure.sourceName ?? 'Test Script',
                      message: failure.message,
                      compactLabel: 'Test Failure',
                      compactMessage: failure.message,
                      detailedMessage: failure.message,
                      line: failure.line,
                      column: failure.column,
                      sourceLine: failure.sourceLine,
                    })
                  }}
                  disabled={failure.line === null}
                >
                  <div className="flex shrink-0 items-center bg-error/10 px-2.5 text-[11px] font-semibold text-error">
                    {failure.line !== null
                      ? `${failure.line}${failure.column !== null ? `:${failure.column}` : ''}`
                      : 'code'}
                  </div>
                  <div className="min-w-0 flex-1 px-3 py-0 font-mono text-xs leading-5 text-base-content/82">
                    <div className="truncate">{failure.sourceLine ?? 'Source line unavailable'}</div>
                  </div>
                </button>
              ) : null}
              <div className="whitespace-pre-wrap break-words text-xs leading-5 text-base-content/80">
                {failure.message}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
})

function LabeledSelect<TValue extends string>({
  label,
  value,
  options,
  className,
  onChange,
}: {
  label: string
  value: TValue
  options: Array<{ value: TValue; label: string }>
  className: string
  onChange: (value: TValue) => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-100/70 px-2.5 py-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/45">{label}</span>
      <DropdownSelect
        value={value}
        className={className}
        triggerClassName="h-8 border-0 bg-transparent px-0 text-[11px] font-semibold shadow-none"
        menuClassName="left-1/2 w-[180px] -translate-x-1/2"
        options={options}
        onChange={onChange}
      />
    </div>
  )
}

function getResponseBodyViewOptions({
  hasMediaPreview,
  supportsHtmlRender,
}: {
  hasMediaPreview: boolean
  supportsHtmlRender: boolean
}): Array<{ value: ResponseBodyPanelViewMode; label: string }> {
  const options: Array<{ value: ResponseBodyPanelViewMode; label: string }> = []

  if (hasMediaPreview) {
    options.push({ value: 'preview', label: 'Preview' })
  }

  if (supportsHtmlRender) {
    options.push({ value: 'render-html', label: 'Render Html' })
  }

  options.push({ value: 'raw', label: 'Raw' })

  if (!hasMediaPreview) {
    options.push({ value: 'table', label: 'Table' })
  }

  options.push({ value: 'visualizer', label: 'Visualizer' })

  return options
}

function getTestRunHeading(testRun: RequestTestRun) {
  switch (testRun.status) {
    case 'failed':
      return 'Tests failed'
    case 'passed':
      return 'Tests passed'
    case 'skipped':
      return 'Tests skipped'
    default:
      return Typescript.assertUnreachable(testRun.status)
  }
}

function getTestStatusTone(status: RequestTestRun['status']) {
  switch (status) {
    case 'passed':
      return { className: 'text-success' }
    case 'failed':
      return { className: 'text-error' }
    case 'skipped':
      return { className: 'text-warning' }
    default:
      return Typescript.assertUnreachable(status)
  }
}

function TestStatusIcon({ status }: { status: RequestTestRun['status'] }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2Icon className="size-3.5" />
    case 'failed':
      return <XCircleIcon className="size-3.5" />
    case 'skipped':
      return <CircleDashedIcon className="size-3.5" />
    default:
      return Typescript.assertUnreachable(status)
  }
}

function isPersistedResponseBodyViewMode(
  viewMode: ResponseBodyPanelViewMode
): viewMode is PersistedResponseBodyViewMode {
  return viewMode === 'raw' || viewMode === 'table' || viewMode === 'visualizer'
}

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
  requestId,
  requestName,
  requestHistoryCount,
  events,
  onSaveAsExample,
  onSaveToFile,
}: {
  stream: HttpSseStreamState | null
  response: SendRequestResponse | null
  requestId: string | null
  requestName: string
  requestHistoryCount: number | null
  events: SseEventRecord[]
  onSaveAsExample?: () => void
  onSaveToFile?: () => void
}) {
  const headerContentType = getResponseContentType(stream?.headers ?? response?.headers ?? '')
  const durationMs = stream?.durationMs ?? response?.durationMs ?? null
  const status = stream?.status ?? response?.status ?? null
  const statusText = stream?.statusText ?? response?.statusText ?? ''
  const statusTone = getStatusTone(status ?? undefined)
  const saveAsExampleButtonProps = useHoldAction({
    onClick: onSaveAsExample ?? (() => undefined),
    onHold: onSaveToFile ?? (() => undefined),
    disabled: !onSaveAsExample || !onSaveToFile,
  })
  const [viewMode, setViewMode] = useState<'rows' | 'raw'>('rows')
  const [filterValue, setFilterValue] = useState('')
  const rawBody = stream?.body ?? response?.body ?? ''
  const normalizedFilterValue = filterValue.trim().toLowerCase()
  const filteredEvents = useMemo(() => {
    if (!normalizedFilterValue) {
      return events
    }

    return events.filter(event => {
      const eventName = getSseEventDisplayName(event).toLowerCase()
      const eventId = event.id?.toLowerCase() ?? ''
      const eventData = event.data.toLowerCase()

      return (
        eventName.includes(normalizedFilterValue) ||
        eventId.includes(normalizedFilterValue) ||
        eventData.includes(normalizedFilterValue)
      )
    })
  }, [events, normalizedFilterValue])
  const historyButtonLabel =
    requestHistoryCount === null
      ? 'Loading History...'
      : requestHistoryCount > 0
        ? `Show History (${requestHistoryCount})`
        : 'No History'

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-base-100/35 p-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="text-sm font-medium text-base-content">SSE Events</div>
          <input
            type="text"
            value={filterValue}
            onChange={event => setFilterValue(event.target.value)}
            placeholder="Filter events"
            className="h-9 w-full max-w-[240px] rounded-lg border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content outline-none transition placeholder:text-base-content/30 focus:border-base-content/20"
            aria-label="Filter SSE events"
          />
        </div>
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
              title="Save as Example (Hold to Save to File)"
              aria-label="Save as example. Hold to save to file"
              {...saveAsExampleButtonProps}
            >
              <SaveIcon className="h-4 w-4" />
            </button>
          ) : null}
          {headerContentType ? <span>{headerContentType}</span> : null}
          <span>
            {filteredEvents.length} / {events.length} events
          </span>
          {durationMs !== null ? <span>{durationMs} ms</span> : null}
          {status !== null ? (
            <span className={`font-semibold ${statusTone.className}`}>
              {status} {statusText}
            </span>
          ) : null}
          {stream ? <span>{stream.state}</span> : null}
          <div className="ml-1 inline-flex overflow-hidden rounded-lg border border-base-content/10 bg-base-100/70">
            <button
              type="button"
              className={[
                'px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
                viewMode === 'rows'
                  ? 'bg-base-200/80 text-base-content'
                  : 'text-base-content/55 hover:text-base-content',
              ].join(' ')}
              onClick={() => setViewMode('rows')}
            >
              Rows
            </button>
            <button
              type="button"
              className={[
                'border-l border-base-content/10 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
                viewMode === 'raw'
                  ? 'bg-base-200/80 text-base-content'
                  : 'text-base-content/55 hover:text-base-content',
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
            events={filteredEvents}
            emptyMessage={
              normalizedFilterValue
                ? 'No SSE events matched the current filter.'
                : stream
                  ? 'Waiting for SSE events.'
                  : 'Response events will appear here.'
            }
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

function ResponseStatusSummary({ response }: { response: SendRequestResponse | null }) {
  const statusTone = getStatusTone(response?.status)

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

function isRenderableHtmlContentType(contentType: string | null) {
  return contentType?.toLowerCase().startsWith('text/html') ?? false
}

function isImageContentType(contentType: string | null) {
  return contentType?.toLowerCase().startsWith('image/') ?? false
}

function isPdfContentType(contentType: string | null) {
  return contentType?.toLowerCase().includes('application/pdf') ?? false
}

function getResponseImageSource(body: string, contentType: string | null) {
  if (!body.trim() || !contentType) {
    return null
  }

  const normalizedContentType = contentType.toLowerCase()
  if (body.startsWith('data:image/')) {
    return body
  }

  if (normalizedContentType.includes('svg')) {
    return `data:${contentType};charset=utf-8,${encodeURIComponent(body)}`
  }

  if (looksLikeBase64(body)) {
    return `data:${contentType};base64,${body.trim()}`
  }

  try {
    return `data:${contentType};base64,${btoa(body)}`
  } catch {
    return null
  }
}

function getResponsePdfSource(body: string, contentType: string | null) {
  if (!body.trim() || !contentType || !isPdfContentType(contentType)) {
    return null
  }

  if (body.startsWith('data:application/pdf')) {
    return body
  }

  if (looksLikeBase64(body)) {
    return `data:${contentType};base64,${body.trim()}`
  }

  return null
}

function looksLikeBase64(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)
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

function formatTestRunDetails(testRun: RequestTestRun | null) {
  if (!testRun) {
    return ''
  }

  const lines = [
    `Status: ${testRun.status}`,
    `Summary: ${testRun.passedCount} passed, ${testRun.failedCount} failed, ${testRun.skippedCount} skipped`,
    `Duration: ${testRun.durationMs} ms`,
  ]

  for (const line of formatTestSuiteLines(testRun.suites)) {
    lines.push(line)
  }

  return lines.join('\n')
}

function formatTestSuiteLines(suites: RequestTestRun['suites'], indent = ''): string[] {
  const lines: string[] = []

  for (const suite of suites) {
    lines.push(`${indent}[${suite.status}] ${suite.name} (${suite.durationMs} ms)`)
    for (const test of suite.tests) {
      lines.push(`${indent}  - [${test.status}] ${test.name} (${test.durationMs} ms)`)
      for (const failure of test.failures) {
        lines.push(`${indent}    ${failure.message}`)
      }
    }
    lines.push(...formatTestSuiteLines(suite.suites, `${indent}  `))
  }

  return lines
}

function clampResponsePaneHeight(height: number) {
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  return Math.max(180, Math.min(height, Math.floor(viewportHeight * 0.8)))
}

const EMPTY_SCRIPT_ERRORS: RequestScriptError[] = []
