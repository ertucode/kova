import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CopyIcon, InfoIcon, LibraryBigIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import type { Extension } from '@codemirror/state'
import { getAuthVariableSources } from '@common/Auth'
import type { RequestScriptError, RequestBodyType, RequestMethod, RequestRawType } from '@common/Requests'
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
import { formatJson5PreferringJson } from '@common/Json5'
import { getWindowElectron } from '@/getWindowElectron'
import { errorResponseToMessage } from '@common/GenericError'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { dialogActions } from '@/global/dialogStore'
import { getWarnBeforeRequestAfterSeconds } from '@/global/appSettingsStore'
import { Tooltip } from '../components/Tooltip'
import { HeadersEditor } from './HeadersEditor'
import { CodeEditor, type CodeEditorHandle, type CodeEditorLanguage, type CodeEditorPasteParams } from './CodeEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { KeyValueEditor } from './KeyValueEditor'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { RequestExecutionCoordinator, requestExecutionStore } from './requestExecutionStore'
import { REQUEST_BODY_TYPES, REQUEST_METHODS, REQUEST_RAW_TYPES, type RequestDetailsDraft } from './folderExplorerTypes'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { pathParamHighlightExtension } from './codeEditorPathParamHighlight'
import { searchParamHighlightExtension } from './codeEditorSearchParamHighlight'
import { AuthorizationEditor } from './AuthorizationEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { RequestDetailsResponsePanel } from './RequestDetailsResponsePanel'
import { buildImportedHttpUrlFields } from './requestUrlImport'
import { buildPastedValue, isFullValueReplacement } from './urlPaste'

export function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [isSending, setIsSending] = useState(false)
  const [metaTab, setMetaTab] = useState<'overview' | 'search-params' | 'scripts' | 'response-visualizer'>('overview')
  const metaTabByRequestIdRef = useRef<
    Record<string, 'overview' | 'search-params' | 'scripts' | 'response-visualizer'>
  >({})
  const draftRef = useRef(draft)
  const preRequestEditorRef = useRef<CodeEditorHandle | null>(null)
  const postRequestEditorRef = useRef<CodeEditorHandle | null>(null)
  const responseVisualizerEditorRef = useRef<CodeEditorHandle | null>(null)
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const selectedRequestIdRef = useRef<string | null>(selectedRequestId)
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  draftRef.current = draft
  selectedRequestIdRef.current = selectedRequestId

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
  const variableHighlightRefreshKey = useMemo(
    () => buildVariableHighlightRefreshKey(activeEnvironmentIds, activeEnvironmentVariableNames),
    [activeEnvironmentIds, activeEnvironmentVariableNames]
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

  const variableEditorExtensionsWithBrowserTabFallback = useMemo(
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
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current, { fallbackToBrowserTab: true }),
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
          const requestId = selectedRequestId
          const latestDraft = draftRef.current
          if (!requestId || latestDraft.itemType !== 'request' || selectedRequestIdRef.current !== requestId) {
            return
          }

          const nextRows = pathParamRowsRef.current.map(row => (row.key.trim() === name ? { ...row, value } : row))
          const nextPathParams = stringifyKeyValueRows(nextRows)

          FolderExplorerCoordinator.updateDraft(
            { itemType: 'request', id: requestId },
            {
              ...latestDraft,
              pathParams: nextPathParams,
              url: syncUrlWithSearchParams(
                syncUrlWithPathParams(latestDraft.url, nextPathParams),
                latestDraft.searchParams
              ),
            }
          )
        },
      }),
      searchParamHighlightExtension(),
      ...variableEditorExtensions,
    ],
    [selectedRequestId, variableEditorExtensions]
  )

  const preRequestScriptExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension('pre-request'),
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
      scriptDiagnosticsExtension('post-request'),
      scriptAutocompleteExtension({
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNames,
        getVariableNames: () => activeEnvironmentVariableNames,
      }),
    ],
    [activeEnvironmentNames, activeEnvironmentVariableNames]
  )

  const responseVisualizerExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension('response-visualizer'),
      scriptAutocompleteExtension({
        phase: 'response-visualizer',
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNames,
        getVariableNames: () => activeEnvironmentVariableNames,
      }),
    ],
    [activeEnvironmentNames, activeEnvironmentVariableNames]
  )

  const visualizerEnvironments = useMemo(
    () =>
      variableTooltipRows.map(row => ({
        id: row.id,
        name: row.name,
        isActive: row.isActive,
        priority: row.priority,
        createdAt: row.createdAt,
        values: Object.fromEntries(row.valueByVariableName.entries()),
      })),
    [variableTooltipRows]
  )
  const hasPreRequestScript = draft.preRequestScript.trim().length > 0
  const hasPostRequestScript = draft.postRequestScript.trim().length > 0
  const usedVariableNames = useMemo(() => getUsedRequestVariableNames(draft), [draft])

  useEffect(() => {
    if (!selectedRequestId) {
      setMetaTab('overview')
      return
    }

    const existingMetaTab = metaTabByRequestIdRef.current[selectedRequestId]
    if (existingMetaTab) {
      setMetaTab(existingMetaTab)
      return
    }

    const initialMetaTab = shouldDefaultToSearchParamsTab(draft) ? 'search-params' : 'overview'
    metaTabByRequestIdRef.current[selectedRequestId] = initialMetaTab
    setMetaTab(initialMetaTab)
  }, [draft, selectedRequestId])

  const updateMetaTab = useCallback(
    (nextMetaTab: 'overview' | 'search-params' | 'scripts' | 'response-visualizer') => {
      if (selectedRequestId) {
        metaTabByRequestIdRef.current[selectedRequestId] = nextMetaTab
      }

      setMetaTab(nextMetaTab)
    },
    [selectedRequestId]
  )

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

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
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

    const activeEnvironments = environments
      .filter(environment => state.activeEnvironmentIds.includes(environment.id))
      .map(environment => {
        const environmentDraft = environmentEntries[environment.id]?.current
        return {
          ...environment,
          name: environmentDraft?.name ?? environment.name,
          color: environmentDraft?.color ?? environment.color,
          warnOnRequest: environmentDraft?.warnOnRequest ?? environment.warnOnRequest,
        }
      })

    const shouldConfirmRequest = shouldWarnBeforeRequest(
      requestExecutionStore.getSnapshot().context.lastRequestSentAt,
      getWarnBeforeRequestAfterSeconds(),
      activeEnvironments
    )

    if (shouldConfirmRequest) {
      const confirmed = await confirmRequestWithActiveEnvironments(
        activeEnvironments,
        getWarnBeforeRequestAfterSeconds()
      )
      if (!confirmed) {
        return
      }
    }

    const sentAt = Date.now()

    setIsSending(true)
    requestExecutionStore.trigger.requestStarted({ requestId: selected.id, sentAt })
    requestExecutionStore.trigger.httpSseStreamCleared({ requestId: selected.id })

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
      saveToHistory: latestDraft.saveToHistory,
      historyKeepLast: requestExecutionStore.getSnapshot().context.historyKeepLast,
    })

    setIsSending(false)

    if (!result.success) {
      requestExecutionStore.trigger.requestFailed({
        requestId: selected.id,
        error: errorResponseToMessage(result.error),
        scriptErrors: result.error.type === 'message' ? result.error.scriptErrors : undefined,
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

  const updateUrl = useCallback((nextUrl: string) => {
    const latestDraft = draftRef.current

    FolderExplorerCoordinator.updateSelectedDraft({
      ...latestDraft,
      url: nextUrl,
      pathParams: syncPathParamsWithUrl(nextUrl, latestDraft.pathParams),
      searchParams: syncSearchParamsWithUrl(nextUrl, latestDraft.searchParams),
    })
  }, [])

  const importUrl = (nextUrl: string) => {
    const importedUrlFields = buildImportedHttpUrlFields(nextUrl, draft.bodyType)
    const { metaTab: nextMetaTab, ...nextUrlFields } = importedUrlFields

    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      ...nextUrlFields,
    })

    updateMetaTab(nextMetaTab)

    toast.show({
      severity: 'success',
      title: 'Imported URL',
      message: 'Rebuilt request URL fields from pasted URL.',
    })
  }

  const handleUrlPaste = ({ text, value, selectionFrom, selectionTo }: CodeEditorPasteParams) => {
    const parsedCurl = parseCurlRequest(text)
    if (parsedCurl) {
      const shouldShowSearchParams = parsedCurl.bodyType === 'none' && parsedCurl.searchParams.trim() !== ''

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

      updateMetaTab(shouldShowSearchParams ? 'search-params' : 'overview')

      toast.show({
        severity: 'success',
        title: 'Imported cURL',
        message: 'Updated request fields from pasted cURL command.',
      })
      return true
    }

    const nextUrl = buildPastedValue({ value, pasteText: text, selectionFrom, selectionTo }).trim()
    if (!nextUrl || nextUrl.includes('\n')) {
      return false
    }

    try {
      new URL(nextUrl)
    } catch {
      return false
    }

    if (isFullValueReplacement({ value, selectionFrom, selectionTo })) {
      importUrl(nextUrl)
      return true
    }

    updateUrl(nextUrl)
    return true
  }

  const updatePathParams = useCallback((nextPathParams: string) => {
    const latestDraft = draftRef.current

    FolderExplorerCoordinator.updateSelectedDraft({
      ...latestDraft,
      pathParams: nextPathParams,
      url: syncUrlWithSearchParams(syncUrlWithPathParams(latestDraft.url, nextPathParams), latestDraft.searchParams),
    })
  }, [])

  const updateSearchParams = useCallback((nextSearchParams: string) => {
    const latestDraft = draftRef.current

    FolderExplorerCoordinator.updateSelectedDraft({
      ...latestDraft,
      searchParams: nextSearchParams,
      url: syncUrlWithSearchParams(latestDraft.url, nextSearchParams),
    })
  }, [])

  const formatJsonBody = async () => {
    try {
      const latestDraft = draftRef.current
      const formatted = await formatJson5PreferringJson(latestDraft.body)
      FolderExplorerCoordinator.updateSelectedDraft({
        ...latestDraft,
        body: formatted,
      })
    } catch {
      toast.show({
        severity: 'warning',
        title: 'Invalid JSON5',
        message: 'Fix JSON5 errors before formatting.',
      })
    }
  }

  const handleJumpToScriptError = useCallback(
    (error: RequestScriptError) => {
      if (error.phase === 'pre-request') {
        updateMetaTab('scripts')
        window.requestAnimationFrame(() => {
          preRequestEditorRef.current?.focusLine(error.line ?? 1, error.column)
        })
        return
      }

      updateMetaTab('scripts')
      window.requestAnimationFrame(() => {
        postRequestEditorRef.current?.focusLine(error.line ?? 1, error.column)
      })
    },
    [updateMetaTab]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="w-full border-b border-base-content/10">
        <div className="flex w-full border border-base-content/10 bg-base-100/70">
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

          <CodeEditor
            testId="request-url-editor"
            value={draft.url}
            language="plain"
            singleLine
            compact
            linePaddingOverride="0 1rem !important"
            className="border-0 w-[20px]"
            placeholder="https://api.example.com/users/:userId"
            extensions={urlEditorExtensions}
            refreshKey={variableHighlightRefreshKey}
            onPasteText={handleUrlPaste}
            onChange={updateUrl}
          />

          <button
            type="button"
            className="shrink-0 border-0 border-l border-base-content/10 bg-base-200 px-4 py-2 text-sm font-medium text-base-content transition hover:bg-base-300"
            onClick={() => {
              if (isSending && selectedRequestId) {
                void getWindowElectron().cancelHttpRequest({ requestId: selectedRequestId })
                return
              }

              void sendRequest()
            }}
          >
            {isSending ? 'Stop' : 'Send'}
          </button>
        </div>

        <VariableUsageBanner
          metaTab={metaTab}
          onMetaTabChange={updateMetaTab}
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
                  refreshKey={variableHighlightRefreshKey}
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
              valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
              valueEditorRefreshKey={variableHighlightRefreshKey}
            />

            <HeadersEditor
              value={draft.headers}
              valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
              valueEditorRefreshKey={variableHighlightRefreshKey}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
            />

            <KeyValueEditor
              label="Path Params"
              value={draft.pathParams}
              onChange={updatePathParams}
              keyPlaceholder="userId"
              valuePlaceholder="123"
              valueEditorAsCode
              valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
              valueEditorRefreshKey={variableHighlightRefreshKey}
            />
          </div>
        </section>
      ) : null}

      {metaTab === 'search-params' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <SearchParamsTab
            value={draft.searchParams}
            onChange={updateSearchParams}
            valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
            valueEditorRefreshKey={variableHighlightRefreshKey}
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
            showLineNumbers
            extensions={preRequestScriptExtensions}
            editorRef={preRequestEditorRef}
            headerActions={<ScriptDocumentationButton phase="pre-request" tooltip="Documentation" />}
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
            showLineNumbers
            extensions={postRequestScriptExtensions}
            editorRef={postRequestEditorRef}
            headerActions={<ScriptDocumentationButton phase="post-request" tooltip="Documentation" />}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      {metaTab === 'response-visualizer' ? (
        <section className="min-h-0 flex-1">
          <div className="relative h-full">
            <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
              <Tooltip content="Copy" placement="left">
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-base-content/10 bg-base-100/90 px-2.5 text-base-content/60 backdrop-blur transition hover:border-base-content/20 hover:text-base-content"
                  onClick={() =>
                    void copyTextToClipboard(draft.responseVisualizer, 'Response visualizer copied to clipboard.')
                  }
                  aria-label="Copy response visualizer"
                >
                  <CopyIcon className="size-4" />
                </button>
              </Tooltip>
              <ScriptDocumentationButton
                phase="response-visualizer"
                mode="examples"
                tooltip="Examples"
                className="h-8 rounded-lg border border-base-content/10 bg-base-100/90 px-0 backdrop-blur"
              />
              <ScriptDocumentationButton
                phase="response-visualizer"
                tooltip="Documentation"
                className="h-8 w-8 rounded-lg border border-base-content/10 bg-base-100/90 backdrop-blur"
              />
            </div>
            <CodeEditor
              ref={responseVisualizerEditorRef}
              value={draft.responseVisualizer}
              language="jsx"
              size="small"
              showLineNumbers
              minHeightClassName="min-h-0 h-full"
              className="h-full border-x-0 border-b-0 border-t-0"
              placeholder={RESPONSE_VISUALIZER_PLACEHOLDER}
              extensions={responseVisualizerExtensions}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseVisualizer: value })}
              onBlur={() => undefined}
            />
          </div>
        </section>
      ) : null}

      <RequestDetailsResponsePanel
        isSending={isSending}
        draft={draft}
        onJumpToScriptError={handleJumpToScriptError}
        visualizerEnvironments={visualizerEnvironments}
      />
    </div>
  )
}

function shouldWarnBeforeRequest(
  lastRequestSentAt: number | null,
  warnBeforeRequestAfterSeconds: number,
  activeEnvironments: Array<{ warnOnRequest: boolean }>
) {
  if (!activeEnvironments.some(environment => environment.warnOnRequest)) {
    return false
  }

  if (lastRequestSentAt === null) {
    return true
  }

  return Date.now() - lastRequestSentAt > warnBeforeRequestAfterSeconds * 1000
}

function confirmRequestWithActiveEnvironments(
  activeEnvironments: Array<{
    id: string
    name: string
    color: string | null
    warnOnRequest: boolean
    priority: number
  }>,
  warnBeforeRequestAfterSeconds: number
) {
  return new Promise<boolean>(resolve => {
    confirmation.trigger.confirm({
      title: 'Send request?',
      message: (
        <ActiveEnvironmentConfirmation
          environments={activeEnvironments}
          warnBeforeRequestAfterSeconds={warnBeforeRequestAfterSeconds}
        />
      ),
      confirmText: 'Send request',
      rejectText: 'Cancel',
      onConfirm: () => resolve(true),
      onReject: () => resolve(false),
    })
  })
}

function ActiveEnvironmentConfirmation({
  environments,
  warnBeforeRequestAfterSeconds,
}: {
  environments: Array<{ id: string; name: string; color: string | null; warnOnRequest: boolean; priority: number }>
  warnBeforeRequestAfterSeconds: number
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-base-content/70">
        More than {warnBeforeRequestAfterSeconds} seconds passed since the last request. These active environments will
        be used for this request.
      </p>

      <div className="space-y-2">
        {environments.map(environment => (
          <div
            key={environment.id}
            className="flex items-center gap-3 rounded-xl border border-base-content/10 bg-base-200/40 px-3 py-2"
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-base-content/10"
              style={{ backgroundColor: environment.color ?? 'var(--color-base-content)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-base-content">{environment.name}</span>
            <span className="text-[11px] text-base-content/45">Priority {environment.priority}</span>
            {environment.warnOnRequest ? (
              <span className="rounded-full bg-warning/15 px-2 py-1 text-[11px] font-medium text-warning">Warn</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function ScriptDocumentationButton({
  phase,
  className,
  mode = 'full',
  tooltip,
}: {
  phase: 'pre-request' | 'post-request' | 'response-visualizer'
  className?: string
  mode?: 'full' | 'examples'
  tooltip?: string
}) {
  const ariaLabel =
    mode === 'examples'
      ? phase === 'response-visualizer'
        ? 'Open response visualizer examples'
        : 'Open script examples'
      : phase === 'pre-request'
        ? 'Open pre-request script documentation'
        : phase === 'post-request'
          ? 'Open post-request script documentation'
          : 'Open response visualizer documentation'

  const button = (
    <button
      type="button"
      className={[
        'grid w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content h-full cursor-pointer',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => dialogActions.open({ component: ScriptDocumentationDialog, props: { phase, mode } })}
      aria-label={ariaLabel}
    >
      {mode === 'examples' ? <LibraryBigIcon className="size-3.5" /> : <InfoIcon className="size-3.5" />}
    </button>
  )

  if (!tooltip) {
    return button
  }

  return (
    <Tooltip content={tooltip} placement="left">
      {button}
    </Tooltip>
  )
}

const RESPONSE_VISUALIZER_PLACEHOLDER = `export default function ResponseVisualizer() {
  const data = response?.body.type === 'json' ? response.body.data : null

  return (
    <div style={{ padding: 16 }}>
      <h2>Status: {response?.status ?? '...'}</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}`

async function copyTextToClipboard(value: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.show({ severity: 'success', message: successMessage })
  } catch {
    toast.show({ severity: 'error', message: 'Could not write the response body to the clipboard.' })
  }
}

function VariableUsageBanner({
  metaTab,
  onMetaTabChange,
  usedVariableNames,
  hasPreRequestScript,
  hasPostRequestScript,
}: {
  metaTab: 'overview' | 'search-params' | 'scripts' | 'response-visualizer'
  onMetaTabChange: (tab: 'overview' | 'search-params' | 'scripts' | 'response-visualizer') => void
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
          data-testid="request-search-params-tab-button"
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
        <button
          type="button"
          className={[
            'flex h-10 items-center gap-2 border-l border-base-content/10 px-3 text-xs font-semibold transition',
            metaTab === 'response-visualizer'
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange('response-visualizer')}
        >
          <span>Response Visualizer</span>
        </button>
      </div>

      <div className="ml-auto max-w-[60%] overflow-auto px-3 text-right whitespace-nowrap [scrollbar-width:thin]">
        {usedVariableNames.length > 0 ? `Vars: ${usedVariableNames.join(', ')}` : 'No vars used'}
      </div>
    </div>
  )
}

const SearchParamsTab = memo(function SearchParamsTab({
  value,
  onChange,
  valueEditorExtensions,
  valueEditorRefreshKey,
}: {
  value: string
  onChange: (value: string) => void
  valueEditorExtensions?: Extension[]
  valueEditorRefreshKey?: string
}) {
  return (
    <div data-testid="search-params-tab">
      <KeyValueEditor
        label={null}
        value={value}
        onChange={onChange}
        keyPlaceholder="page"
        valuePlaceholder="1"
        contentClassName="border-t-0"
        warnOnDuplicate={false}
        valueEditorAsCode
        valueEditorExtensions={valueEditorExtensions}
        valueEditorRefreshKey={valueEditorRefreshKey}
      />
    </div>
  )
})

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

  for (const source of getAuthVariableSources(draft.auth)) {
    collect(source)
  }

  return Array.from(variableNames).sort((left, right) => left.localeCompare(right))
}

function shouldDefaultToSearchParamsTab(draft: RequestDetailsDraft) {
  return draft.bodyType === 'none' && draft.searchParams.trim().length > 0
}

function MethodBadge({ method }: { method: RequestMethod }) {
  const tone = getMethodTone(method)

  return <span className={`inline-flex items-center text-xs font-semibold tracking-[0.12em] ${tone}`}>{method}</span>
}

function getMethodTone(method: RequestMethod) {
  switch (method) {
    case 'GET':
      return 'text-success'
    case 'POST':
      return 'text-info'
    case 'PUT':
      return 'text-warning'
    case 'PATCH':
      return 'text-secondary'
    case 'DELETE':
      return 'text-error'
    case 'HEAD':
      return 'text-accent'
    case 'OPTIONS':
      return 'text-base-content/70'
    default:
      return 'text-base-content/70'
  }
}

function isParamBodyType(bodyType: RequestBodyType) {
  return bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded'
}

function getRawEditorLanguage(rawType: RequestRawType): CodeEditorLanguage {
  return rawType === 'json' ? 'json5' : 'plain'
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
    color: environment.color,
    warnOnRequest: environment.warnOnRequest,
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

function buildVariableHighlightRefreshKey(activeEnvironmentIds: string[], variableNames: string[]) {
  const normalizedActiveEnvironmentIds = [...activeEnvironmentIds].sort((left, right) => left.localeCompare(right))
  const normalizedVariableNames = [...variableNames].sort((left, right) => left.localeCompare(right))

  return `${normalizedActiveEnvironmentIds.join('|')}::${normalizedVariableNames.join('|')}`
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

if (typeof document !== 'undefined' && !document.getElementById('request-loading-keyframes')) {
  const styleElement = document.createElement('style')
  styleElement.id = 'request-loading-keyframes'
  styleElement.textContent = `
    @keyframes request-loading {
      0% {
        transform: translateX(-120%);
      }
      100% {
        transform: translateX(320%);
      }
    }
  `
  document.head.appendChild(styleElement)
}

export function getActiveSearchParam(url: string, caretPos: number) {
  const queryStart = url.indexOf('?')
  if (queryStart === -1 || caretPos <= queryStart) return null

  // End of query (before hash if exists)
  const hashIndex = url.indexOf('#', queryStart)
  const queryEnd = hashIndex === -1 ? url.length : hashIndex

  const query = url.slice(queryStart + 1, queryEnd)

  let cursor = queryStart + 1

  const pairs = query.split('&')

  for (const pair of pairs) {
    const start = cursor
    const end = cursor + pair.length

    if (caretPos >= start && caretPos <= end) {
      const eqIndex = pair.indexOf('=')

      if (eqIndex === -1) {
        return { key: pair, value: '' }
      }

      const key = pair.slice(0, eqIndex)
      const value = pair.slice(eqIndex + 1)

      return { key, value }
    }

    cursor = end + 1 // skip '&'
  }

  return null
}
