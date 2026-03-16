import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { InfoIcon, SaveIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { getAuthVariableSources } from '@common/Auth'
import type { RequestBodyType, RequestMethod, RequestRawType, SendRequestResponse } from '@common/Requests'
import { parseCurlRequest } from '@common/curl'
import { resolveEnvironmentVariables } from '@common/EnvironmentVariables'
import { buildEnvironmentVariableMap, extractTemplateVariables } from '@common/RequestVariables'
import {
  syncPathParamsWithUrl,
  syncSearchParamsWithUrl,
  syncUrlWithPathParams,
  syncUrlWithSearchParams,
} from '@common/PathParams'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { getWindowElectron } from '@/getWindowElectron'
import { errorResponseToMessage } from '@common/GenericError'
import { toast } from '@/lib/components/toast'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { dialogActions } from '@/global/dialogStore'
import { HeadersEditor } from './HeadersEditor'
import { CodeEditor, type CodeEditorLanguage } from './CodeEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { KeyValueEditor } from './KeyValueEditor'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore, saveFolderExplorerUiState } from './folderExplorerEditorStore'
import { RequestExecutionCoordinator, requestExecutionStore } from './requestExecutionStore'
import { REQUEST_BODY_TYPES, REQUEST_METHODS, REQUEST_RAW_TYPES, type RequestDetailsDraft } from './folderExplorerTypes'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { pathParamHighlightExtension } from './codeEditorPathParamHighlight'
import { AuthorizationEditor } from './AuthorizationEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'

export function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [isSending, setIsSending] = useState(false)
  const [isResizingResponsePane, setIsResizingResponsePane] = useState(false)
  const [metaTab, setMetaTab] = useState<'overview' | 'search-params' | 'scripts'>('overview')
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const responsePaneHeight = useSelector(folderExplorerEditorStore, state => state.context.responsePaneHeight)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const response = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.responseByRequestId[selectedRequestId] ?? null) : null
  )
  const responseError = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.errorByRequestId[selectedRequestId] ?? null) : null
  )

  const activeEnvironmentNames = useMemo(
    () =>
      environments
        .filter(environment => activeEnvironmentIds.includes(environment.id))
        .map(environment => environment.name),
    [activeEnvironmentIds, environments]
  )

  const activeEnvironmentVariableNames = useMemo(() => {
    const activeEnvironments = environments
      .filter(environment => activeEnvironmentIds.includes(environment.id))
      .map(environment => {
        const draft = environmentEntries[environment.id]?.current

        return {
          ...environment,
          name: draft?.name ?? environment.name,
          variables: draft?.variables ?? environment.variables,
          priority: draft?.priority ?? environment.priority,
        }
      })

    return Object.keys(buildEnvironmentVariableMap(activeEnvironments))
  }, [activeEnvironmentIds, environmentEntries, environments])

  const variableTooltipRows = useMemo(
    () =>
      environments.map(environment => {
        const draft = environmentEntries[environment.id]?.current
        const variables = draft?.variables ?? environment.variables
        return {
          id: environment.id,
          name: draft?.name ?? environment.name,
          isActive: activeEnvironmentIds.includes(environment.id),
          priority: draft?.priority ?? environment.priority,
          createdAt: environment.createdAt,
          valueByVariableName: new Map(
            Array.from(resolveEnvironmentVariables({ variables }).entries()).map(([key, row]) => [key, row.value])
          ),
        }
      }),
    [activeEnvironmentIds, environmentEntries, environments]
  )

  const variableAutocompleteItems = useMemo(
    () => buildVariableAutocompleteItems(variableTooltipRows),
    [variableTooltipRows]
  )

  const activeEnvironmentVariableNamesRef = useRef(activeEnvironmentVariableNames)
  const variableTooltipRowsRef = useRef(variableTooltipRows)
  const variableAutocompleteItemsRef = useRef(variableAutocompleteItems)
  const definedPathParamNamesRef = useRef<string[]>([])
  const pathParamRowsRef = useRef(parseKeyValueRows(draft.pathParams))

  activeEnvironmentVariableNamesRef.current = activeEnvironmentVariableNames
  variableTooltipRowsRef.current = variableTooltipRows
  variableAutocompleteItemsRef.current = variableAutocompleteItems
  pathParamRowsRef.current = parseKeyValueRows(draft.pathParams)
  definedPathParamNamesRef.current = pathParamRowsRef.current.map(row => row.key.trim()).filter(Boolean)

  const variableEditorExtensions = useMemo(
    () => [
      variableHighlightExtension({
        getDefinedVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getEnvironments: () => variableTooltipRowsRef.current,
        onToggleEnvironment: environmentId => EnvironmentCoordinator.toggleActiveEnvironment(environmentId),
        onOpenEnvironment: environmentId => EnvironmentCoordinator.openEnvironmentDetails(environmentId),
        onChangeValue: (environmentId, variableName, value) =>
          updateEnvironmentVariableDraft(environmentId, variableName, value),
        onSaveValue: environmentId => EnvironmentCoordinator.saveEnvironment(environmentId),
      }),
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current),
    ],
    []
  )

  const urlEditorExtensions = useMemo(
    () => [
      pathParamHighlightExtension({
        getDefinedPathParamNames: () => definedPathParamNamesRef.current,
        getPathParamValue: name => pathParamRowsRef.current.find(row => row.key.trim() === name)?.value ?? '',
        getPathParamDescription: name =>
          pathParamRowsRef.current.find(row => row.key.trim() === name)?.description ?? '',
        onChangeValue: (name, value) => {
          const nextRows = pathParamRowsRef.current.map(row => (row.key.trim() === name ? { ...row, value } : row))

          updatePathParams(stringifyKeyValueRows(nextRows))
        },
      }),
      ...variableEditorExtensions,
    ],
    [variableEditorExtensions]
  )

  const preRequestScriptExtensions = useMemo(
    () => [
      scriptAutocompleteExtension({
        includeResponse: false,
        getEnvironmentNames: () => activeEnvironmentNames,
        getVariableNames: () => activeEnvironmentVariableNames,
      }),
    ],
    [activeEnvironmentNames, activeEnvironmentVariableNames]
  )

  const postRequestScriptExtensions = useMemo(
    () => [
      scriptAutocompleteExtension({
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNames,
        getVariableNames: () => activeEnvironmentVariableNames,
      }),
    ],
    [activeEnvironmentNames, activeEnvironmentVariableNames]
  )

  const formattedResponseBody = useMemo(() => {
    if (!response) return ''
    return formatResponseBody(response.body, response.headers)
  }, [response])

  const responseContentType = useMemo(() => getResponseContentType(response?.headers ?? ''), [response?.headers])
  const hasPreRequestScript = draft.preRequestScript.trim().length > 0
  const hasPostRequestScript = draft.postRequestScript.trim().length > 0
  const usedVariableNames = useMemo(() => getUsedRequestVariableNames(draft), [draft])

  useEffect(() => {
    const clampedHeight = clampResponsePaneHeight(responsePaneHeight)
    if (clampedHeight !== responsePaneHeight) {
      folderExplorerEditorStore.trigger.responsePaneHeightChanged({ height: clampedHeight })
    }
  }, [responsePaneHeight])

  useEffect(() => {
    setMetaTab('overview')
  }, [selectedRequestId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!isSending) {
          void sendRequest()
        }
      }
    }

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

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isSending])

  const sendRequest = async () => {
    const state = folderExplorerEditorStore.getSnapshot().context
    const selected = state.selected
    if (!selected || selected.itemType !== 'request') {
      requestExecutionStore.trigger.requestFailed({ requestId: 'unknown', error: 'Request selection is missing' })
      return
    }

    const entry = state.entries[`request:${selected.id}`]
    const latestDraft = entry?.current
    if (!latestDraft || latestDraft.itemType !== 'request') {
      requestExecutionStore.trigger.requestFailed({ requestId: selected.id, error: 'Request draft is missing' })
      return
    }

    setIsSending(true)

    const result = await getWindowElectron().sendRequest({
      requestId: selected.id,
      method: latestDraft.method,
      url: latestDraft.url,
      pathParams: latestDraft.pathParams,
      searchParams: latestDraft.searchParams,
      auth: latestDraft.auth,
      preRequestScript: latestDraft.preRequestScript,
      postRequestScript: latestDraft.postRequestScript,
      headers: latestDraft.headers,
      body: latestDraft.body,
      bodyType: latestDraft.bodyType,
      rawType: latestDraft.rawType,
      activeEnvironmentIds: state.activeEnvironmentIds,
      historyKeepLast: requestExecutionStore.getSnapshot().context.historyKeepLast,
    })

    setIsSending(false)

    if (!result.success) {
      requestExecutionStore.trigger.requestFailed({
        requestId: selected.id,
        error: errorResponseToMessage(result.error),
      })
      return
    }

    requestExecutionStore.trigger.requestSucceeded({
      requestId: selected.id,
      requestName: latestDraft.name,
      requestDraft: latestDraft,
      response: result.data,
    })
    void RequestExecutionCoordinator.refreshHistory()
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: responsePaneHeight,
    }
    setIsResizingResponsePane(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  const saveCurrentResponseAsExample = async () => {
    if (!selectedRequestId || !response) {
      return
    }

    const result = await getWindowElectron().createRequestExample({
      requestId: selectedRequestId,
      name: `${draft.name} ${response.status}`,
      requestHeaders: draft.headers,
      requestBody: draft.body,
      requestBodyType: draft.bodyType,
      requestRawType: draft.rawType,
      responseStatus: response.status,
      responseStatusText: response.statusText,
      responseHeaders: response.headers,
      responseBody: response.body,
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    await FolderExplorerCoordinator.loadItems()
    FolderExplorerCoordinator.selectItem({ itemType: 'example', id: result.data.id })
    toast.show({ severity: 'success', title: 'Example saved', message: `Saved response example for ${draft.name}.` })
  }

  const updateUrl = (nextUrl: string) => {
    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      url: nextUrl,
      pathParams: syncPathParamsWithUrl(nextUrl, draft.pathParams),
      searchParams: syncSearchParamsWithUrl(nextUrl, draft.searchParams),
    })
  }

  const handleUrlPaste = (value: string) => {
    const parsedCurl = parseCurlRequest(value)
    if (!parsedCurl) {
      return false
    }

    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      method: parsedCurl.method,
      url: parsedCurl.url,
      pathParams: parsedCurl.pathParams,
      searchParams: parsedCurl.searchParams,
      auth: parsedCurl.auth,
      headers: parsedCurl.headers,
      body: parsedCurl.body,
      bodyType: parsedCurl.bodyType,
      rawType: parsedCurl.rawType,
    })

    toast.show({
      severity: 'success',
      title: 'Imported cURL',
      message: 'Updated request fields from pasted cURL command.',
    })
    return true
  }

  const updatePathParams = (nextPathParams: string) => {
    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      pathParams: nextPathParams,
      url: syncUrlWithSearchParams(syncUrlWithPathParams(draft.url, nextPathParams), draft.searchParams),
    })
  }

  const updateSearchParams = (nextSearchParams: string) => {
    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      searchParams: nextSearchParams,
      url: syncUrlWithSearchParams(draft.url, nextSearchParams),
    })
  }

  const formatJsonBody = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(draft.body), null, 2)
      FolderExplorerCoordinator.updateSelectedDraft({
        ...draft,
        body: formatted,
      })
    } catch {
      toast.show({
        severity: 'warning',
        title: 'Invalid JSON',
        message: 'Fix JSON errors before formatting.',
      })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="w-full border-b border-base-content/10">
        <div className="flex w-full overflow-visible border border-base-content/10 bg-base-100/70">
          <DropdownSelect
            value={draft.method}
            className="z-20 w-[126px] shrink-0 border-r border-base-content/10 bg-base-200/55"
            triggerClassName="tracking-[0.08em]"
            menuClassName="w-[220px]"
            options={REQUEST_METHODS.map(option => ({
              value: option,
              label: <MethodBadge method={option} />,
            }))}
            renderValue={option => option.label}
            onChange={value =>
              FolderExplorerCoordinator.updateSelectedDraft({ ...draft, method: value as RequestMethod })
            }
          />

          <div className="flex min-w-0 flex-1 overflow-hidden">
            <CodeEditor
              value={draft.url}
              language="plain"
              singleLine
              className="min-w-0 flex-1 border-0"
              placeholder="https://api.example.com/users/:userId"
              extensions={urlEditorExtensions}
              onPasteText={handleUrlPaste}
              onChange={updateUrl}
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
        </div>

        <VariableUsageBanner
          metaTab={metaTab}
          onMetaTabChange={setMetaTab}
          usedVariableNames={usedVariableNames}
          hasPreRequestScript={hasPreRequestScript}
          hasPostRequestScript={hasPostRequestScript}
        />
      </section>

      {metaTab === 'overview' ? (
        <section className="grid min-h-0 flex-1 w-full border-base-content/10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-h-0 border-b border-base-content/10 md:border-b-0 md:border-r md:border-base-content/10">
            <div className="flex h-full min-h-0 flex-col">
              <DetailsSectionHeader
                title="Body"
                actions={
                  <>
                    <DropdownSelect
                      value={draft.bodyType}
                      className="w-[100px]"
                      triggerClassName="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium capitalize"
                      menuClassName="w-[220px]"
                      options={REQUEST_BODY_TYPES.map(option => ({
                        value: option,
                        label: <span className="capitalize">{option}</span>,
                      }))}
                      onChange={value =>
                        FolderExplorerCoordinator.updateSelectedDraft({
                          ...draft,
                          bodyType: value as RequestBodyType,
                        })
                      }
                    />
                    <DropdownSelect
                      value={draft.rawType}
                      className={`w-[120px] ${draft.bodyType !== 'raw' ? 'pointer-events-none opacity-45' : ''}`}
                      triggerClassName="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase"
                      menuClassName="w-[180px]"
                      options={REQUEST_RAW_TYPES.map(option => ({
                        value: option,
                        label: <span className="uppercase">{option}</span>,
                      }))}
                      onChange={value =>
                        FolderExplorerCoordinator.updateSelectedDraft({
                          ...draft,
                          rawType: value as RequestRawType,
                        })
                      }
                    />
                    {draft.bodyType === 'raw' && draft.rawType === 'json' ? (
                      <button
                        type="button"
                        className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase tracking-[0.08em] text-base-content transition hover:bg-base-200/70"
                        onClick={formatJsonBody}
                      >
                        Format
                      </button>
                    ) : null}
                  </>
                }
              />

              {draft.bodyType === 'raw' ? (
                <CodeEditor
                  value={draft.body}
                  language={getRawEditorLanguage(draft.rawType)}
                  size="small"
                  minHeightClassName="min-h-0 h-full"
                  className="border-x-0 border-b-0"
                  placeholder={'{\n  "hello": "world"\n}'}
                  extensions={variableEditorExtensions}
                  onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: value })}
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
                <div className="flex min-h-0 h-full items-center justify-center bg-base-100/35 text-sm text-base-content/45">
                  No request body
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-y-auto">
            <AuthorizationEditor
              value={draft.auth}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, auth: value })}
              allowInherit
              valueEditorExtensions={variableEditorExtensions}
            />

            <HeadersEditor
              value={draft.headers}
              valueEditorExtensions={variableEditorExtensions}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
            />

            <KeyValueEditor
              label="Path Params"
              value={draft.pathParams}
              onChange={updatePathParams}
              keyPlaceholder="userId"
              valuePlaceholder="123"
              valueEditorAsCode
              valueEditorExtensions={variableEditorExtensions}
            />
          </div>
        </section>
      ) : null}

      {metaTab === 'search-params' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <KeyValueEditor
            label={null}
            value={draft.searchParams}
            onChange={updateSearchParams}
            keyPlaceholder="page"
            valuePlaceholder="1"
            contentClassName="border-t-0"
          />
        </section>
      ) : null}

      {metaTab === 'scripts' ? (
        <section className="grid min-h-0 flex-1 md:grid-cols-2">
          <DetailsTextArea
            label="Pre-request Script"
            value={draft.preRequestScript}
            minHeightClassName="min-h-0 h-full"
            sectionClassName="flex min-h-0 flex-1 flex-col md:border-r md:border-base-content/10"
            editorLanguage="javascript"
            editorSize="small"
            extensions={preRequestScriptExtensions}
            headerActions={<ScriptDocumentationButton phase="pre-request" />}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
            onBlur={() => undefined}
          />

          <DetailsTextArea
            label="Post-request Script"
            value={draft.postRequestScript}
            minHeightClassName="min-h-0 h-full"
            sectionClassName="flex min-h-0 flex-1 flex-col"
            editorLanguage="javascript"
            editorSize="small"
            extensions={postRequestScriptExtensions}
            headerActions={<ScriptDocumentationButton phase="post-request" />}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      <section className="shrink-0 overflow-hidden bg-base-100/95" style={{ height: `${responsePaneHeight}px` }}>
        <button
          type="button"
          className={`block h-[3px] w-full cursor-ns-resize border-0 transition-colors ${
            isResizingResponsePane ? 'bg-base-content/35' : 'bg-base-content/10 hover:bg-base-content/25'
          } `}
          onPointerDown={startResize}
          aria-label="Resize response panel"
          title="Resize response panel"
        />

        <div className="flex min-h-0 flex-col overflow-hidden h-[calc(100%-2px)]">
          {/* <DetailsSectionHeader */}
          {/*   title="Response" */}
          {/*   actions={<ResponseStatusSummary response={response} responseError={responseError} />} */}
          {/* /> */}
          <ResponseScriptErrors errors={response?.scriptErrors ?? []} />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <ResponseBodyPanel
              value={formattedResponseBody}
              description="Response body will appear here."
              contentType={responseContentType}
              response={response}
              responseError={responseError}
              onSaveAsExample={response ? () => void saveCurrentResponseAsExample() : undefined}
            />
            <ResponseHeadersPanel value={response?.headers ?? ''} description="Response headers will appear here." />
          </div>
        </div>
      </section>
    </div>
  )
}

function ScriptDocumentationButton({ phase }: { phase: 'pre-request' | 'post-request' }) {
  return (
    <button
      type="button"
      className="grid w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
      onClick={() => dialogActions.open({ component: ScriptDocumentationDialog, props: { phase } })}
      aria-label={
        phase === 'pre-request' ? 'Open pre-request script documentation' : 'Open post-request script documentation'
      }
      title="Script documentation"
    >
      <InfoIcon className="size-3.5" />
    </button>
  )
}

function ResponseScriptErrors({ errors }: { errors: SendRequestResponse['scriptErrors'] }) {
  if (errors.length === 0) {
    return null
  }

  return (
    <div className="whitespace-pre-wrap border-b border-base-content/10 bg-warning/8 px-3 py-2 text-sm text-warning-content/90">
      {errors.map(error => `${error.sourceName}: ${error.message}`).join('\n')}
    </div>
  )
}

function VariableUsageBanner({
  metaTab,
  onMetaTabChange,
  usedVariableNames,
  hasPreRequestScript,
  hasPostRequestScript,
}: {
  metaTab: 'overview' | 'search-params' | 'scripts'
  onMetaTabChange: (tab: 'overview' | 'search-params' | 'scripts') => void
  usedVariableNames: string[]
  hasPreRequestScript: boolean
  hasPostRequestScript: boolean
}) {
  return (
    <div className="flex min-h-10 items-center border-b border-base-content/10 text-xs text-base-content/50">
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          className={[
            'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
            metaTab === 'overview'
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={[
            'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
            metaTab === 'search-params'
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange('search-params')}
        >
          Search Params
        </button>
        <button
          type="button"
          className={[
            'flex h-10 items-center gap-2 px-3 text-xs font-semibold transition',
            metaTab === 'scripts'
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange('scripts')}
        >
          <span>Scripts</span>
          <span className={metaTab === 'scripts' ? 'text-base-content/55' : 'text-base-content/30'}>
            <span className={hasPreRequestScript ? '' : 'opacity-45'}>Pre</span>
            <span className="mx-1">/</span>
            <span className={hasPostRequestScript ? '' : 'opacity-45'}>Post</span>
          </span>
        </button>
      </div>

      <div className="ml-auto max-w-[60%] overflow-auto px-3 text-right whitespace-nowrap [scrollbar-width:thin]">
        {usedVariableNames.length > 0 ? `Vars: ${usedVariableNames.join(', ')}` : 'No vars used'}
      </div>
    </div>
  )
}

function getUsedRequestVariableNames(draft: RequestDetailsDraft) {
  const variableNames = new Set<string>()

  const collect = (value: string) => {
    for (const variableName of extractTemplateVariables(value)) {
      variableNames.add(variableName)
    }
  }

  collect(draft.url)
  collect(draft.pathParams)
  collect(draft.searchParams)
  collect(draft.headers)
  collect(draft.body)
  collect(draft.preRequestScript)
  collect(draft.postRequestScript)

  for (const source of getAuthVariableSources(draft.auth)) {
    collect(source)
  }

  return Array.from(variableNames).sort((left, right) => left.localeCompare(right))
}

function MethodBadge({ method }: { method: RequestMethod }) {
  const tone = getMethodTone(method)

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-[0.12em] ${tone}`}
    >
      {method}
    </span>
  )
}

function getMethodTone(method: RequestMethod) {
  switch (method) {
    case 'GET':
      return 'bg-info/15 text-info'
    case 'POST':
      return 'bg-success/15 text-success'
    case 'PUT':
      return 'bg-accent/18 text-accent'
    case 'PATCH':
      return 'bg-warning/18 text-warning-content'
    case 'DELETE':
      return 'bg-error/15 text-error'
    case 'HEAD':
      return 'bg-secondary/18 text-secondary'
    case 'OPTIONS':
      return 'bg-base-content/10 text-base-content/75'
    default:
      return 'bg-base-content/10 text-base-content'
  }
}

function ResponseBodyPanel({
  value,
  description,
  contentType,
  response,
  responseError,
  onSaveAsExample,
}: {
  value: string
  description: string
  contentType: string | null
  response: SendRequestResponse | null
  responseError: string | null
  onSaveAsExample?: () => void
}) {
  const language = detectResponseLanguage(contentType, value)

  return (
    <div className="flex min-h-0 flex-[2] flex-col bg-base-100/35 p-2 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="text-sm font-medium text-base-content">Response Body</div>
        <div className="flex gap-2 items-center">
          {onSaveAsExample ? (
            <button
              type="button"
              className="rounded-lg bg-base-100/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
              onClick={onSaveAsExample}
            >
              <SaveIcon className="w-4 h-4" />
            </button>
          ) : null}
          {contentType ? <div className="text-xs text-base-content/45">{contentType}</div> : null}
          <ResponseStatusSummary response={response} responseError={responseError} />
        </div>
      </div>

      {value ? (
        <div className="min-h-0 flex-1 overflow-hidden h-full">
          <CodeEditor
            value={value}
            language={language}
            readOnly
            size="small"
            className="border-0 h-full"
            hideFocusOutline
            onChange={() => undefined}
            compact
          />
        </div>
      ) : (
        <div className="mt-2 text-sm text-base-content/50">{description}</div>
      )}
    </div>
  )
}

function ResponseHeadersPanel({ value, description }: { value: string; description: string }) {
  const rows = parseResponseHeaders(value)

  return (
    <div className="flex min-h-0 flex-1 flex-col border-l border-base-content/12 bg-base-100/35 p-2 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="text-sm font-medium text-base-content">Response Headers</div>
      </div>

      {rows.length > 0 ? (
        <div className="mt-3 min-h-0 flex-1 overflow-auto">
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
    <div className="flex gap-2 items-center">
      <div className="text-xs text-base-content/45">{response.durationMs} ms</div>
      <div className={`text-sm font-semibold ${statusTone.className}`}>
        {response.status} {response.statusText}
      </div>
    </div>
  )
}

function isParamBodyType(bodyType: RequestBodyType) {
  return bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded'
}

function getRawEditorLanguage(rawType: RequestRawType): CodeEditorLanguage {
  return rawType === 'json' ? 'json' : 'plain'
}

function updateEnvironmentVariableDraft(environmentId: string, variableName: string, value: string) {
  const state = environmentEditorStore.getSnapshot().context
  const environment = state.items.find(item => item.id === environmentId)
  const draft = state.entries[environmentId]?.current
  if (!environment) {
    return
  }

  const currentDraft = draft ?? {
    name: environment.name,
    variables: environment.variables,
    priority: environment.priority,
  }

  const nextVariables = upsertVariableValue(currentDraft.variables, variableName, value)
  EnvironmentCoordinator.updateDraft(environmentId, { ...currentDraft, variables: nextVariables })
}

function upsertVariableValue(variables: string, variableName: string, value: string) {
  const rows = parseKeyValueRows(variables)
  const existingRow = rows.find(row => row.key.trim() === variableName)

  if (existingRow) {
    return stringifyKeyValueRows(rows.map(row => (row.key.trim() === variableName ? { ...row, value } : row)))
  }

  const nextRow = createEmptyKeyValueRow()
  nextRow.key = variableName
  nextRow.value = value

  return stringifyKeyValueRows([...rows, nextRow])
}

function buildVariableAutocompleteItems(
  rows: Array<{
    name: string
    isActive: boolean
    priority: number
    createdAt: number
    valueByVariableName: Map<string, string>
  }>
): VariableAutocompleteItem[] {
  const items = new Map<
    string,
    {
      name: string
      effectiveEnvironmentName: string | null
      activeEnvironmentNames: string[]
      inactiveEnvironmentNames: string[]
    }
  >()

  const activeRowsByPriority = rows
    .filter(row => row.isActive)
    .slice()
    .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)

  for (const row of rows) {
    for (const variableName of row.valueByVariableName.keys()) {
      if (variableName.trim() === '') {
        continue
      }

      const current = items.get(variableName) ?? {
        name: variableName,
        effectiveEnvironmentName: null,
        activeEnvironmentNames: [],
        inactiveEnvironmentNames: [],
      }

      if (row.isActive) {
        current.activeEnvironmentNames.push(row.name)
      } else {
        current.inactiveEnvironmentNames.push(row.name)
      }

      items.set(variableName, current)
    }
  }

  for (const [variableName, item] of items) {
    const effectiveRow = activeRowsByPriority.find(row => row.valueByVariableName.has(variableName))
    item.effectiveEnvironmentName = effectiveRow?.name ?? null
    item.activeEnvironmentNames.sort((left, right) => left.localeCompare(right))
    item.inactiveEnvironmentNames.sort((left, right) => left.localeCompare(right))
    items.set(variableName, item)
  }

  return Array.from(items.values())
}

function formatResponseBody(body: string, headers: string) {
  if (!body.trim()) return ''

  const contentType = getResponseContentType(headers)?.toLowerCase()

  const looksJson = contentType?.includes('json') || /^[\[{]/.test(body.trim())
  if (looksJson) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
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
