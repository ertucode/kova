import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { CopyIcon, InfoIcon, LibraryBigIcon, PencilIcon, SaveIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import type { Extension } from '@codemirror/state'
import { buildClientSchema, type GraphQLSchema, type IntrospectionQuery } from 'graphql'
import type { ExplorerItem } from '@common/Explorer'
import { getAuthVariableSources } from '@common/Auth'
import type { RequestMetaTab } from '@common/FolderExplorerTabs'
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
import {
  createEmptyKeyValueRow,
  parseKeyValueRows,
  stringifyKeyValueRows,
  type KeyValueRow,
} from '@common/KeyValueRows'
import { formatJson5PreferringJsonWithTemplates } from '@common/Json5'
import { getWindowElectron } from '@/getWindowElectron'
import { DEFAULT_COMPACT_REQUEST_VIEW } from '@common/AppSettings'
import { toast } from '@/lib/components/toast'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { dialogActions } from '@/global/dialogStore'
import { appSettingsStore, getFormatScriptBlocksOnSave } from '@/global/appSettingsStore'
import { Tooltip } from '../components/Tooltip'
import { HeadersEditor } from './HeadersEditor'
import {
  CodeEditor,
  type CodeEditorHandle,
  type CodeEditorLanguage,
  type CodeEditorPasteParams,
  type CodeEditorSelection,
} from './CodeEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { KeyValueEditor } from './KeyValueEditor'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { RequestSendCoordinator } from './requestSendCoordinator'
import { REQUEST_BODY_TYPES, REQUEST_METHODS, REQUEST_RAW_TYPES, type RequestDetailsDraft } from './folderExplorerTypes'
import {
  variableAutocompleteExtension,
  type VariableAutocompleteItem,
} from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { scriptHoverExtension } from './codeEditorScriptHover'
import { supermavenGhostCompletionExtension } from './codeEditorSupermaven'
import { pathParamHighlightExtension } from './codeEditorPathParamHighlight'
import { searchParamHighlightExtension } from './codeEditorSearchParamHighlight'
import { createTemplateCompletionSource, templateScriptExtension } from './codeEditorTemplateScript'
import type { ScriptAutocompletePackage, ScriptAutocompleteSharedScript } from './scriptAutocompleteTypes'
import { AuthorizationEditor } from './AuthorizationEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { RequestDetailsResponsePanel } from './RequestDetailsResponsePanel'
import { jsonDiagnosticsExtension } from './codeEditorJsonDiagnostics'
import { graphqlDiagnosticsExtension } from './codeEditorGraphqlDiagnostics'
import { graphqlSchemaExtension } from './codeEditorGraphqlSchema'
import { buildImportedHttpUrlFields } from './requestUrlImport'
import { buildPastedValue, isFullValueReplacement } from './urlPaste'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { buildHttpRequestPaths } from './folderExplorerUtils'
import { useVisibleSharedScripts } from './useVisibleSharedScripts'
import { useScriptPackageArtifacts } from './useScriptPackages'
import type { PendingScriptSelection } from './scriptFormatOnSave'
import { formatScriptValueForSave } from './scriptFormatOnSave'
import { ScriptAiIconButton } from './ScriptAiIconButton'
import { twMerge } from 'tailwind-merge'

export function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [isSending, setIsSending] = useState(false)
  const [isFetchingGraphqlSchema, setIsFetchingGraphqlSchema] = useState(false)
  const compactRequestView = useSelector(
    appSettingsStore,
    state => state.context.settings?.compactRequestView ?? DEFAULT_COMPACT_REQUEST_VIEW
  )
  const { artifacts: scriptPackageArtifacts } = useScriptPackageArtifacts()
  const draftRef = useRef(draft)
  const preRequestEditorRef = useRef<CodeEditorHandle | null>(null)
  const postRequestEditorRef = useRef<CodeEditorHandle | null>(null)
  const testEditorRef = useRef<CodeEditorHandle | null>(null)
  const responseVisualizerEditorRef = useRef<CodeEditorHandle | null>(null)
  const preRequestSelectionRef = useRef<CodeEditorSelection | null>(null)
  const postRequestSelectionRef = useRef<CodeEditorSelection | null>(null)
  const testSelectionRef = useRef<CodeEditorSelection | null>(null)
  const responseVisualizerSelectionRef = useRef<CodeEditorSelection | null>(null)
  const pendingPreRequestSelectionRef = useRef<PendingScriptSelection | null>(null)
  const pendingPostRequestSelectionRef = useRef<PendingScriptSelection | null>(null)
  const pendingTestSelectionRef = useRef<PendingScriptSelection | null>(null)
  const pendingResponseVisualizerSelectionRef = useRef<PendingScriptSelection | null>(null)
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const selectedRequestMetaTab = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request'
      ? (state.context.tabs.find(tab => tab.id === state.context.activeTabId)?.requestMetaTab ?? null)
      : null
  )
  const currentRequestSelection = selectedRequestId ? { itemType: 'request' as const, id: selectedRequestId } : null
  const selectedRequestIdRef = useRef<string | null>(selectedRequestId)
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const selectedRequestFolderId = useSelector(folderExplorerTreeStore, state => {
    const request = state.context.items.find(
      (item): item is Extract<(typeof state.context.items)[number], { itemType: 'request' }> =>
        item.itemType === 'request' && item.id === selectedRequestId
    )
    return request?.parentFolderId ?? null
  })
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const { scripts: visibleSharedScripts } = useVisibleSharedScripts(selectedRequestFolderId)
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
  const activeEnvironmentNamesRef = useRef(activeEnvironmentNames)
  const variableTooltipRowsRef = useRef(variableTooltipRows)
  const variableAutocompleteItemsRef = useRef(variableAutocompleteItems)
  const visibleSharedScriptsRef = useRef(visibleSharedScripts)
  const scriptPackageArtifactsRef = useRef(scriptPackageArtifacts)
  const definedPathParamNamesRef = useRef<string[]>([])
  const pathParamRowsRef = useRef(parseKeyValueRows(draft.pathParams))
  const searchParamsValueRef = useRef(draft.searchParams)

  activeEnvironmentNamesRef.current = activeEnvironmentNames
  activeEnvironmentVariableNamesRef.current = activeEnvironmentVariableNames
  variableTooltipRowsRef.current = variableTooltipRows
  variableAutocompleteItemsRef.current = variableAutocompleteItems
  visibleSharedScriptsRef.current = visibleSharedScripts
  scriptPackageArtifactsRef.current = scriptPackageArtifacts
  pathParamRowsRef.current = parseKeyValueRows(draft.pathParams)
  searchParamsValueRef.current = draft.searchParams
  definedPathParamNamesRef.current = pathParamRowsRef.current.map(row => row.key.trim()).filter(Boolean)

  const variableEditorBaseExtensions = useMemo(
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
      templateScriptExtension({
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
    ],
    []
  )

  const variableEditorExtensions = useMemo(
    () => [
      ...variableEditorBaseExtensions,
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current, {
        extraSources: [
          createTemplateCompletionSource({
            getEnvironmentNames: () => activeEnvironmentNamesRef.current,
            getVariableNames: () => activeEnvironmentVariableNamesRef.current,
            getSharedScripts: () => visibleSharedScriptsRef.current,
            getPackages: () => scriptPackageArtifactsRef.current,
          }),
        ],
      }),
    ],
    [variableEditorBaseExtensions]
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
      templateScriptExtension({
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
        fallbackToBrowserTab: true,
      }),
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current, {
        fallbackToBrowserTab: true,
        extraSources: [
          createTemplateCompletionSource({
            getEnvironmentNames: () => activeEnvironmentNamesRef.current,
            getVariableNames: () => activeEnvironmentVariableNamesRef.current,
            getSharedScripts: () => visibleSharedScriptsRef.current,
            getPackages: () => scriptPackageArtifactsRef.current,
          }),
        ],
      }),
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
      scriptDiagnosticsExtension({
        phase: 'pre-request',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptAutocompleteExtension({
        includeResponse: false,
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptHoverExtension({
        phase: 'pre-request',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      supermavenGhostCompletionExtension({
        getDocumentPath: () => `kova://requests/${selectedRequestIdRef.current ?? 'unknown'}/pre-request.ts`,
        phase: 'pre-request',
      }),
    ],
    []
  )

  const postRequestScriptExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension({
        phase: 'post-request',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptAutocompleteExtension({
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptHoverExtension({
        phase: 'post-request',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      supermavenGhostCompletionExtension({
        getDocumentPath: () => `kova://requests/${selectedRequestIdRef.current ?? 'unknown'}/post-request.ts`,
        phase: 'post-request',
      }),
    ],
    []
  )

  const testScriptExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension({
        phase: 'test',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptAutocompleteExtension({
        phase: 'test',
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptHoverExtension({
        phase: 'test',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      supermavenGhostCompletionExtension({
        getDocumentPath: () => `kova://requests/${selectedRequestIdRef.current ?? 'unknown'}/test.ts`,
        phase: 'test',
      }),
    ],
    []
  )

  const responseVisualizerExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension({
        phase: 'response-visualizer',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptAutocompleteExtension({
        phase: 'response-visualizer',
        includeResponse: true,
        getEnvironmentNames: () => activeEnvironmentNamesRef.current,
        getVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptHoverExtension({
        phase: 'response-visualizer',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => visibleSharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      supermavenGhostCompletionExtension({
        getDocumentPath: () => `kova://requests/${selectedRequestIdRef.current ?? 'unknown'}/response-visualizer.tsx`,
        phase: 'response-visualizer',
      }),
    ],
    []
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
  const responsePanelRequestDraft = useMemo(
    () => ({
      method: draft.method,
      url: draft.url,
      pathParams: draft.pathParams,
      searchParams: draft.searchParams,
      auth: draft.auth,
      headers: draft.headers,
      body: draft.body,
      bodyType: draft.bodyType,
      rawType: draft.rawType,
    }),
    [
      draft.auth,
      draft.body,
      draft.bodyType,
      draft.headers,
      draft.method,
      draft.pathParams,
      draft.rawType,
      draft.searchParams,
      draft.url,
    ]
  )
  const visualizerSharedScripts = useMemo(
    () => visibleSharedScripts.filter(script => script.targets.includes('response-visualizer')),
    [visibleSharedScripts]
  )
  const graphqlSchema = useMemo(() => parseGraphqlSchema(draft.graphqlSchema), [draft.graphqlSchema])
  const hasPreRequestScript = draft.preRequestScript.trim().length > 0
  const hasPostRequestScript = draft.postRequestScript.trim().length > 0
  const usedVariableNames = useMemo(() => getUsedRequestVariableNames(draft), [draft])
  const metaTab = useMemo(() => {
    if (!selectedRequestId) {
      return compactRequestView ? 'overview' : 'body'
    }

    if (selectedRequestMetaTab) {
      return normalizeMetaTabForLayout(selectedRequestMetaTab, compactRequestView)
    }

    return shouldDefaultToSearchParamsTab(draft) ? 'search-params' : compactRequestView ? 'overview' : 'body'
  }, [compactRequestView, draft, selectedRequestId, selectedRequestMetaTab])

  useEffect(() => {
    if (!selectedRequestId || selectedRequestMetaTab) {
      return
    }

    void FolderExplorerCoordinator.updateSelectedRequestMetaTab(metaTab)
  }, [metaTab, selectedRequestId, selectedRequestMetaTab])

  const updateMetaTab = useCallback(
    (nextMetaTab: RequestMetaTab) => {
      const normalizedMetaTab = normalizeMetaTabForLayout(nextMetaTab, compactRequestView)

      if (selectedRequestId) {
        void FolderExplorerCoordinator.updateSelectedRequestMetaTab(normalizedMetaTab)
      }
    },
    [compactRequestView, selectedRequestId]
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

  useEffect(() => {
    return FolderExplorerCoordinator.registerSelectedSaveHandler(handleSaveWithFormatting)
  }, [handleSaveWithFormatting])

  const sendRequest = async () => {
    setIsSending(true)
    try {
      await RequestSendCoordinator.sendSelectedRequest()
    } catch {
      return
    } finally {
      setIsSending(false)
    }
  }

  const updateRequestDraft = useCallback(
    (nextDraft: RequestDetailsDraft, debugLabel?: string) => {
      if (!currentRequestSelection) {
        return false
      }

      return FolderExplorerCoordinator.updateSelectedDraftIfMatching(currentRequestSelection, nextDraft, debugLabel)
    },
    [currentRequestSelection]
  )

  async function handleSaveWithFormatting() {
    if (!currentRequestSelection) {
      return
    }

    let nextDraft = draftRef.current
    if (getFormatScriptBlocksOnSave()) {
      nextDraft = await formatRequestDraftScriptsForSave(nextDraft)
      if (nextDraft !== draftRef.current) {
        updateRequestDraft(nextDraft, 'request-format-save')
      }
    }

    await FolderExplorerCoordinator.saveSelectedItemDirect({ skipFormatting: true })
  }

  const updateUrl = useCallback(
    (nextUrl: string) => {
      const latestDraft = draftRef.current
      const nextSearchParams = syncSearchParamsWithUrl(nextUrl, searchParamsValueRef.current)
      searchParamsValueRef.current = nextSearchParams

      updateRequestDraft(
        {
          ...latestDraft,
          url: nextUrl,
          pathParams: syncPathParamsWithUrl(nextUrl, latestDraft.pathParams),
          searchParams: nextSearchParams,
        },
        'request-url'
      )
    },
    [updateRequestDraft]
  )

  async function formatRequestDraftScriptsForSave(sourceDraft: RequestDetailsDraft) {
    let changed = false

    const preRequestScript = await formatScriptValueWithSelection(
      sourceDraft.preRequestScript,
      preRequestSelectionRef.current,
      pendingPreRequestSelectionRef,
      'Pre-request script'
    )
    changed = changed || preRequestScript !== sourceDraft.preRequestScript

    const postRequestScript = await formatScriptValueWithSelection(
      sourceDraft.postRequestScript,
      postRequestSelectionRef.current,
      pendingPostRequestSelectionRef,
      'Post-request script'
    )
    changed = changed || postRequestScript !== sourceDraft.postRequestScript

    const responseVisualizer = await formatScriptValueWithSelection(
      sourceDraft.responseVisualizer,
      responseVisualizerSelectionRef.current,
      pendingResponseVisualizerSelectionRef,
      'Response visualizer'
    )
    changed = changed || responseVisualizer !== sourceDraft.responseVisualizer

    const testScript = await formatScriptValueWithSelection(
      sourceDraft.testScript,
      testSelectionRef.current,
      pendingTestSelectionRef,
      'Test script'
    )
    changed = changed || testScript !== sourceDraft.testScript

    if (!changed) {
      return sourceDraft
    }

    return {
      ...sourceDraft,
      preRequestScript,
      postRequestScript,
      testScript,
      responseVisualizer,
    }
  }

  const importUrl = (nextUrl: string) => {
    const importedUrlFields = buildImportedHttpUrlFields(nextUrl, draft.bodyType)
    const { metaTab: nextMetaTab, ...nextUrlFields } = importedUrlFields
    searchParamsValueRef.current = nextUrlFields.searchParams

    updateRequestDraft(
      {
        ...draft,
        ...nextUrlFields,
      },
      'request-import-url'
    )

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
      searchParamsValueRef.current = parsedCurl.searchParams

      updateRequestDraft(
        {
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
        },
        'request-import-curl'
      )

      updateMetaTab(shouldShowSearchParams ? 'search-params' : compactRequestView ? 'overview' : 'body')

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

  const updatePathParams = useCallback(
    (nextPathParams: string) => {
      const latestDraft = draftRef.current

      updateRequestDraft(
        {
          ...latestDraft,
          pathParams: nextPathParams,
          url: syncUrlWithSearchParams(
            syncUrlWithPathParams(latestDraft.url, nextPathParams),
            latestDraft.searchParams
          ),
        },
        'request-path-params'
      )
    },
    [updateRequestDraft]
  )

  const updateSearchParams = useCallback(
    (nextSearchParams: string) => {
      const latestDraft = draftRef.current
      searchParamsValueRef.current = nextSearchParams

      updateRequestDraft(
        {
          ...latestDraft,
          searchParams: nextSearchParams,
          url: syncUrlWithSearchParams(latestDraft.url, nextSearchParams),
        },
        'request-search-params'
      )
    },
    [updateRequestDraft]
  )

  useEffect(() => {
    return getWindowElectron().onGenericEvent(event => {
      if (event.type !== 'fix-request-search-param-value') {
        return
      }

      const rows = parseKeyValueRows(draftRef.current.searchParams)
      const row = rows.find(candidate => candidate.id === event.rowId)
      if (!row) {
        return
      }

      const nextValue = decodeSearchParamValue(row.value)
      if (nextValue === null || nextValue === row.value) {
        return
      }

      updateSearchParams(
        stringifyKeyValueRows(rows.map(candidate => (candidate.id === event.rowId ? { ...candidate, value: nextValue } : candidate)))
      )
    })
  }, [updateSearchParams])

  const formatBody = async () => {
    const latestDraft = draftRef.current

    if (latestDraft.bodyType === 'graphql') {
      let graphqlQuery = latestDraft.graphqlQuery
      let graphqlVariables = latestDraft.graphqlVariables
      let hasInvalidQuery = false
      let hasInvalidVariables = false

      if (graphqlQuery.trim()) {
        try {
          graphqlQuery = await formatGraphqlQueryWithTemplates(graphqlQuery)
        } catch {
          hasInvalidQuery = true
        }
      }

      if (graphqlVariables.trim()) {
        try {
          graphqlVariables = await formatJson5PreferringJsonWithTemplates(graphqlVariables)
        } catch {
          hasInvalidVariables = true
        }
      }

      if (graphqlQuery !== latestDraft.graphqlQuery || graphqlVariables !== latestDraft.graphqlVariables) {
        updateRequestDraft(
          {
            ...latestDraft,
            graphqlQuery,
            graphqlVariables,
          },
          'request-format-graphql-body'
        )
      }

      if (hasInvalidQuery || hasInvalidVariables) {
        toast.show({
          severity: 'warning',
          title: 'Could not format GraphQL body',
          message:
            hasInvalidQuery && hasInvalidVariables
              ? 'Fix GraphQL query and variables errors before formatting.'
              : hasInvalidQuery
                ? 'Fix GraphQL query errors before formatting.'
                : 'Fix JSON5 errors in GraphQL variables before formatting.',
        })
      }

      return
    }

    try {
      const formatted = await formatJson5PreferringJsonWithTemplates(latestDraft.body)
      updateRequestDraft(
        {
          ...latestDraft,
          body: formatted,
        },
        'request-format-json-body'
      )
    } catch {
      toast.show({
        severity: 'warning',
        title: 'Invalid JSON5',
        message: 'Fix JSON5 errors before formatting.',
      })
    }
  }

  const pickFormDataFilePath = useCallback(async (row: KeyValueRow) => {
    const result = await getWindowElectron().pickFilePath({ defaultPath: row.value.trim() || undefined })
    return result.success ? result.data.filePath : null
  }, [])

  const fetchRequestGraphqlSchema = useCallback(async () => {
    if (!selectedRequestId) {
      return
    }

    setIsFetchingGraphqlSchema(true)
    try {
      const result = await getWindowElectron().fetchGraphqlSchema({
        requestId: selectedRequestId,
        method: draftRef.current.method,
        url: draftRef.current.url,
        pathParams: draftRef.current.pathParams,
        searchParams: draftRef.current.searchParams,
        auth: draftRef.current.auth,
        preRequestScript: draftRef.current.preRequestScript,
        headers: draftRef.current.headers,
        body: draftRef.current.body,
        bodyType: draftRef.current.bodyType,
        rawType: draftRef.current.rawType,
        graphqlQuery: draftRef.current.graphqlQuery,
        graphqlVariables: draftRef.current.graphqlVariables,
        activeEnvironmentIds,
      })

      if (!result.success) {
        toast.show(result)
        return
      }

      updateRequestDraft(
        {
          ...draftRef.current,
          graphqlSchema: result.data.schema,
        },
        'request-graphql-schema'
      )
      toast.show({ severity: 'success', title: 'Fetched GraphQL schema', message: 'Schema autocomplete is ready.' })
    } finally {
      setIsFetchingGraphqlSchema(false)
    }
  }, [activeEnvironmentIds, selectedRequestId, updateRequestDraft])

  const handleJumpToScriptError = useCallback(
    (error: RequestScriptError) => {
      if (error.phase === 'pre-request') {
        updateMetaTab('scripts')
        window.requestAnimationFrame(() => {
          preRequestEditorRef.current?.focusLine(error.line ?? 1, error.column)
        })
        return
      }

      if (error.phase === 'test') {
        updateMetaTab('tests')
        window.requestAnimationFrame(() => {
          testEditorRef.current?.focusLine(error.line ?? 1, error.column)
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

  const updateResponseVisualizer = useCallback(
    (value: string) => {
      const latestDraft = draftRef.current

      updateRequestDraft(
        {
          ...latestDraft,
          responseVisualizer: value,
        },
        'request-response-visualizer'
      )
    },
    [updateRequestDraft]
  )

  const fillResponseVisualizerTemplate = useCallback(() => {
    const latestDraft = draftRef.current

    updateRequestDraft(
      {
        ...latestDraft,
        responseVisualizer: `
export default function View() {
  
}
`,
      },
      'request-fill-response-visualizer-template'
    )
    setTimeout(() => responseVisualizerEditorRef.current?.focusLine(3, 4), 0)
  }, [updateRequestDraft])

  const bodyTab = (
    <RequestBodyTab
      draft={draft}
      formatBody={formatBody}
      getSharedScripts={() => visibleSharedScriptsRef.current}
      getPackages={() => scriptPackageArtifactsRef.current}
      pickFormDataFilePath={pickFormDataFilePath}
      graphqlSchema={graphqlSchema}
      showHeader={compactRequestView}
      isFetchingGraphqlSchema={isFetchingGraphqlSchema}
      onFetchGraphqlSchema={fetchRequestGraphqlSchema}
      updateRequestDraft={updateRequestDraft}
      variableEditorExtensions={variableEditorExtensions}
      variableHighlightRefreshKey={variableHighlightRefreshKey}
    />
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
            onChange={value => updateRequestDraft({ ...draft, method: value as RequestMethod }, 'request-method')}
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
          compactRequestView={compactRequestView}
          metaTab={metaTab}
          onMetaTabChange={updateMetaTab}
          usedVariableNames={usedVariableNames}
          hasPreRequestScript={hasPreRequestScript}
          hasPostRequestScript={hasPostRequestScript}
        />
      </section>

      {metaTab === 'overview' ? (
        <RequestOverviewTab
          body={bodyTab}
          draft={draft}
          explorerItems={explorerItems}
          updatePathParams={updatePathParams}
          updateRequestDraft={updateRequestDraft}
          variableEditorExtensionsWithBrowserTabFallback={variableEditorExtensionsWithBrowserTabFallback}
          variableHighlightRefreshKey={variableHighlightRefreshKey}
        />
      ) : null}

      {metaTab === 'body' ? bodyTab : null}

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

      {metaTab === 'headers' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <HeadersEditor
            value={draft.headers}
            showHeader={false}
            valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
            valueEditorRefreshKey={variableHighlightRefreshKey}
            onChange={value => updateRequestDraft({ ...draft, headers: value }, 'request-headers-tab')}
          />
        </section>
      ) : null}

      {metaTab === 'auth' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <AuthorizationEditor
            value={draft.auth}
            onChange={value => updateRequestDraft({ ...draft, auth: value }, 'request-auth-tab')}
            allowInherit
            showHeader={false}
            valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
            valueEditorRefreshKey={variableHighlightRefreshKey}
            explorerItems={explorerItems}
            showTokenRefreshRequestSelector
          />
        </section>
      ) : null}

      {metaTab === 'path-params' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <KeyValueEditor
            label={null}
            value={draft.pathParams}
            onChange={updatePathParams}
            keyPlaceholder="userId"
            valuePlaceholder="123"
            valueEditorAsCode
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
            externalSelection={
              pendingPreRequestSelectionRef.current?.code === draft.preRequestScript
                ? pendingPreRequestSelectionRef.current.selection
                : null
            }
            headerActions={
              <>
                <ScriptAiIconButton
                  ownerType="request"
                  ownerId={selectedRequestId ?? ''}
                  runtimeContext={{ phase: 'pre-request' }}
                  currentCode={draft.preRequestScript}
                  onApply={nextCode => updateRequestDraft({ ...draft, preRequestScript: nextCode }, 'request-pre-script-ai')}
                  tooltip="Generate with AI"
                />
                <ScriptDocumentationButton phase="pre-request" tooltip="Documentation" />
              </>
            }
            onChange={value => updateRequestDraft({ ...draft, preRequestScript: value }, 'request-pre-script')}
            onSelectionChange={selection => {
              preRequestSelectionRef.current = selection
              if (pendingPreRequestSelectionRef.current?.code === draft.preRequestScript) {
                pendingPreRequestSelectionRef.current = null
              }
            }}
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
            externalSelection={
              pendingPostRequestSelectionRef.current?.code === draft.postRequestScript
                ? pendingPostRequestSelectionRef.current.selection
                : null
            }
            headerActions={
              <>
                <ScriptAiIconButton
                  ownerType="request"
                  ownerId={selectedRequestId ?? ''}
                  runtimeContext={{ phase: 'post-request' }}
                  currentCode={draft.postRequestScript}
                  onApply={nextCode => updateRequestDraft({ ...draft, postRequestScript: nextCode }, 'request-post-script-ai')}
                  tooltip="Generate with AI"
                />
                <ScriptDocumentationButton phase="post-request" tooltip="Documentation" />
              </>
            }
            onChange={value => updateRequestDraft({ ...draft, postRequestScript: value }, 'request-post-script')}
            onSelectionChange={selection => {
              postRequestSelectionRef.current = selection
              if (pendingPostRequestSelectionRef.current?.code === draft.postRequestScript) {
                pendingPostRequestSelectionRef.current = null
              }
            }}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      {metaTab === 'tests' ? (
        <TestScriptTab
          value={draft.testScript}
          extensions={testScriptExtensions}
          editorRef={testEditorRef}
          externalSelection={
            pendingTestSelectionRef.current?.code === draft.testScript ? pendingTestSelectionRef.current.selection : null
          }
          onChange={value => updateRequestDraft({ ...draft, testScript: value }, 'request-test-script')}
          onSelectionChange={selection => {
            testSelectionRef.current = selection
            if (pendingTestSelectionRef.current?.code === draft.testScript) {
              pendingTestSelectionRef.current = null
            }
          }}
          ownerId={selectedRequestId ?? ''}
        />
      ) : null}

      {metaTab === 'response-visualizer' ? (
        <ResponseVisualizerTab
          value={draft.responseVisualizer}
          extensions={responseVisualizerExtensions}
          editorRef={responseVisualizerEditorRef}
          externalSelection={
            pendingResponseVisualizerSelectionRef.current?.code === draft.responseVisualizer
              ? pendingResponseVisualizerSelectionRef.current.selection
              : null
          }
          onChange={updateResponseVisualizer}
          onSelectionChange={selection => {
            responseVisualizerSelectionRef.current = selection
            if (pendingResponseVisualizerSelectionRef.current?.code === draft.responseVisualizer) {
              pendingResponseVisualizerSelectionRef.current = null
            }
          }}
          ownerId={selectedRequestId ?? ''}
          onFillTemplate={fillResponseVisualizerTemplate}
        />
      ) : null}

      <RequestDetailsResponsePanel
        isSending={isSending}
        requestName={draft.name}
        requestHeaders={draft.headers}
        requestBody={draft.body}
        requestBodyType={draft.bodyType}
        requestRawType={draft.rawType}
        requestGraphqlQuery={draft.graphqlQuery}
        requestGraphqlVariables={draft.graphqlVariables}
        responseVisualizer={draft.responseVisualizer}
        responseTableAccessor={draft.responseTableAccessor}
        preferredResponseBodyView={draft.preferredResponseBodyView}
        visualizerRequestDraft={responsePanelRequestDraft}
        onJumpToScriptError={handleJumpToScriptError}
        visualizerEnvironments={visualizerEnvironments}
        sharedScripts={visualizerSharedScripts}
        scriptPackageArtifacts={scriptPackageArtifacts}
      />
    </div>
  )
}

const ResponseVisualizerTab = memo(function ResponseVisualizerTab({
  value,
  extensions,
  editorRef,
  externalSelection,
  onChange,
  onSelectionChange,
  ownerId,
  onFillTemplate,
}: {
  value: string
  extensions: Extension[]
  editorRef: RefObject<CodeEditorHandle | null>
  externalSelection: CodeEditorSelection | null
  onChange: (value: string) => void
  onSelectionChange: (selection: CodeEditorSelection) => void
  ownerId: string
  onFillTemplate: () => void
}) {
  return (
    <section className="min-h-0 flex-1">
      <div className="relative h-full">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <Tooltip content="Fill in the script" placement="left">
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-base-content/10 bg-base-100/90 px-2.5 text-base-content/60 backdrop-blur transition hover:border-base-content/20 hover:text-base-content"
              onClick={onFillTemplate}
              aria-label="Fill response visualizer"
            >
              <PencilIcon className="size-4" />
            </button>
          </Tooltip>
          <Tooltip content="Copy" placement="left">
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-base-content/10 bg-base-100/90 px-2.5 text-base-content/60 backdrop-blur transition hover:border-base-content/20 hover:text-base-content"
              onClick={() => void copyTextToClipboard(value, 'Response visualizer copied to clipboard.')}
              aria-label="Copy response visualizer"
            >
              <CopyIcon className="size-4" />
            </button>
          </Tooltip>
          <ScriptAiIconButton
            ownerType="request"
            ownerId={ownerId}
            runtimeContext={{ phase: 'response-visualizer' }}
            currentCode={value}
            onApply={onChange}
            tooltip="Generate with AI"
            className="h-8 w-10 rounded-lg border border-base-content/10 bg-base-100/90 px-0 backdrop-blur text-base-content/60 hover:border-base-content/20 hover:bg-base-100/90 hover:text-base-content"
          />
          <ScriptDocumentationButton
            phase="response-visualizer"
            mode="examples"
            tooltip="Examples"
            className="h-8 w-10 rounded-lg border border-base-content/10 bg-base-100/90 px-0 backdrop-blur"
          />
          <ScriptDocumentationButton
            phase="response-visualizer"
            tooltip="Documentation"
            className="h-8 w-10 rounded-lg border border-base-content/10 bg-base-100/90 backdrop-blur"
          />
        </div>
        <CodeEditor
          ref={editorRef}
          value={value}
          language="jsx"
          size="small"
          showLineNumbers
          minHeightClassName="min-h-0 h-full"
          className="h-full border-x-0 border-b-0 border-t-0"
          placeholder={RESPONSE_VISUALIZER_PLACEHOLDER}
          extensions={extensions}
          externalSelection={externalSelection}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          onBlur={() => undefined}
        />
      </div>
    </section>
  )
})

function ScriptDocumentationButton({
  phase,
  className,
  mode = 'full',
  tooltip,
}: {
  phase: 'pre-request' | 'post-request' | 'test' | 'response-visualizer'
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
          : phase === 'test'
            ? 'Open test script documentation'
          : 'Open response visualizer documentation'

  const button = (
    <button
      type="button"
      className={twMerge(
        'grid w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content h-full cursor-pointer',
        className
      )}
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

async function formatScriptValueWithSelection(
  value: string,
  selection: CodeEditorSelection | null,
  pendingSelectionRef: { current: PendingScriptSelection | null },
  label: string
) {
  return formatScriptValueForSave(value, selection, pendingSelectionRef, label)
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
  compactRequestView,
  metaTab,
  onMetaTabChange,
  usedVariableNames,
  hasPreRequestScript,
  hasPostRequestScript,
}: {
  compactRequestView: boolean
  metaTab: RequestMetaTab
  onMetaTabChange: (tab: RequestMetaTab) => void
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
            (compactRequestView ? metaTab === 'overview' : metaTab === 'body')
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange(compactRequestView ? 'overview' : 'body')}
        >
          {compactRequestView ? 'Overview' : 'Body'}
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
        {!compactRequestView ? (
          <>
            <button
              type="button"
              className={[
                'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
                metaTab === 'headers'
                  ? 'border-b-2 border-b-base-content text-base-content'
                  : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
              ].join(' ')}
              onClick={() => onMetaTabChange('headers')}
            >
              Headers
            </button>
            <button
              type="button"
              className={[
                'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
                metaTab === 'auth'
                  ? 'border-b-2 border-b-base-content text-base-content'
                  : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
              ].join(' ')}
              onClick={() => onMetaTabChange('auth')}
            >
              Authorization
            </button>
            <button
              type="button"
              className={[
                'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
                metaTab === 'path-params'
                  ? 'border-b-2 border-b-base-content text-base-content'
                  : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
              ].join(' ')}
              onClick={() => onMetaTabChange('path-params')}
            >
              Path Params
            </button>
          </>
        ) : null}
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
            metaTab === 'tests'
              ? 'border-b-2 border-b-base-content text-base-content'
              : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
          ].join(' ')}
          onClick={() => onMetaTabChange('tests')}
        >
          <span>Tests</span>
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

function normalizeMetaTabForLayout(tab: RequestMetaTab, compactRequestView: boolean): RequestMetaTab {
  if (compactRequestView) {
    if (tab === 'body' || tab === 'headers' || tab === 'auth' || tab === 'path-params') {
      return 'overview'
    }

    return tab
  }

  return tab === 'overview' ? 'body' : tab
}

const FLOATING_SCRIPT_ACTION_BUTTON_CLASS_NAME =
  'h-8 w-10 rounded-lg border border-base-content/10 bg-base-100/90 px-0 text-base-content/60 backdrop-blur hover:border-base-content/20 hover:bg-base-100/90 hover:text-base-content'

const TestScriptTab = memo(function TestScriptTab({
  value,
  extensions,
  editorRef,
  externalSelection,
  onChange,
  onSelectionChange,
  ownerId,
}: {
  value: string
  extensions: Extension[]
  editorRef: RefObject<CodeEditorHandle | null>
  externalSelection: CodeEditorSelection | null
  onChange: (value: string) => void
  onSelectionChange: (selection: CodeEditorSelection) => void
  ownerId: string
}) {
  return (
    <section className="min-h-0 flex-1">
      <div className="relative h-full">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <ScriptAiIconButton
            ownerType="request"
            ownerId={ownerId}
            runtimeContext={{ phase: 'test' }}
            currentCode={value}
            onApply={onChange}
            tooltip="Generate with AI"
            className={FLOATING_SCRIPT_ACTION_BUTTON_CLASS_NAME}
          />
          <ScriptDocumentationButton
            phase="test"
            tooltip="Documentation"
            className={FLOATING_SCRIPT_ACTION_BUTTON_CLASS_NAME}
          />
        </div>
        <CodeEditor
          ref={editorRef}
          value={value}
          language="javascript"
          size="small"
          showLineNumbers
          minHeightClassName="min-h-0 h-full"
          className="h-full border-x-0 border-b-0 border-t-0"
          extensions={extensions}
          externalSelection={externalSelection}
          onChange={onChange}
          onSelectionChange={onSelectionChange}
          onBlur={() => undefined}
        />
      </div>
    </section>
  )
})

function RequestOverviewTab({
  body,
  draft,
  explorerItems,
  updatePathParams,
  updateRequestDraft,
  variableEditorExtensionsWithBrowserTabFallback,
  variableHighlightRefreshKey,
}: {
  body: ReactNode
  draft: RequestDetailsDraft
  explorerItems: ExplorerItem[]
  updatePathParams: (nextPathParams: string) => void
  updateRequestDraft: (nextDraft: RequestDetailsDraft, debugLabel?: string) => boolean
  variableEditorExtensionsWithBrowserTabFallback: Extension[]
  variableHighlightRefreshKey: string
}) {
  return (
    <section className="grid min-h-0 flex-1 w-full border-base-content/10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-h-0 border-b border-base-content/10 md:border-b-0 md:border-r md:border-base-content/10">
        {body}
      </div>

      <div className="flex min-h-0 flex-col overflow-y-auto">
        <AuthorizationEditor
          value={draft.auth}
          onChange={value => updateRequestDraft({ ...draft, auth: value }, 'request-auth-overview')}
          allowInherit
          valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
          valueEditorRefreshKey={variableHighlightRefreshKey}
          explorerItems={explorerItems}
          showTokenRefreshRequestSelector
        />

        <HeadersEditor
          value={draft.headers}
          valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
          valueEditorRefreshKey={variableHighlightRefreshKey}
          onChange={value => updateRequestDraft({ ...draft, headers: value }, 'request-headers-overview')}
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
  )
}

function RequestBodyTab({
  draft,
  formatBody,
  getSharedScripts,
  getPackages,
  pickFormDataFilePath,
  graphqlSchema,
  showHeader,
  isFetchingGraphqlSchema,
  onFetchGraphqlSchema,
  updateRequestDraft,
  variableEditorExtensions,
  variableHighlightRefreshKey,
}: {
  draft: RequestDetailsDraft
  formatBody: () => Promise<void>
  getSharedScripts: () => ScriptAutocompleteSharedScript[]
  getPackages: () => ScriptAutocompletePackage[]
  pickFormDataFilePath: (row: KeyValueRow) => Promise<string | null>
  graphqlSchema: GraphQLSchema | null
  showHeader: boolean
  isFetchingGraphqlSchema: boolean
  onFetchGraphqlSchema: () => Promise<void>
  updateRequestDraft: (nextDraft: RequestDetailsDraft, debugLabel?: string) => boolean
  variableEditorExtensions: Extension[]
  variableHighlightRefreshKey: string
}) {
  const jsonBodyExtensions = useMemo(() => {
    if (draft.bodyType !== 'raw' || draft.rawType !== 'json') {
      return variableEditorExtensions
    }

    return [...variableEditorExtensions, jsonDiagnosticsExtension({ getSharedScripts, getPackages })]
  }, [draft.bodyType, draft.rawType, getPackages, getSharedScripts, variableEditorExtensions])
  const graphqlVariablesExtensions = useMemo(
    () => [...variableEditorExtensions, jsonDiagnosticsExtension({ getSharedScripts, getPackages })],
    [getPackages, getSharedScripts, variableEditorExtensions]
  )
  const graphqlQueryExtensions = useMemo(
    () => [
      ...graphqlSchemaExtension(graphqlSchema),
      graphqlDiagnosticsExtension({ getSharedScripts, getPackages }),
    ],
    [getPackages, getSharedScripts, graphqlSchema]
  )

  return (
    <section className="h-full min-h-0 flex-1">
      <div className="flex h-full min-h-0 flex-col">
        {showHeader ? (
          <DetailsSectionHeader
            title="Body"
            actions={
              <RequestBodyTabActions
                draft={draft}
                formatBody={formatBody}
                isFetchingGraphqlSchema={isFetchingGraphqlSchema}
                onFetchGraphqlSchema={onFetchGraphqlSchema}
                updateRequestDraft={updateRequestDraft}
              />
            }
          />
        ) : (
          <div className="flex h-12 min-h-12 max-h-12 items-stretch justify-start border-b border-base-content/10 bg-base-100/70">
            <RequestBodyTabActions
              draft={draft}
              formatBody={formatBody}
              isFetchingGraphqlSchema={isFetchingGraphqlSchema}
              onFetchGraphqlSchema={onFetchGraphqlSchema}
              updateRequestDraft={updateRequestDraft}
            />
          </div>
        )}

        {draft.bodyType === 'raw' ? (
          <CodeEditor
            value={draft.body}
            language={getRawEditorLanguage(draft.rawType)}
            size="small"
            showLineNumbers={draft.rawType === 'json'}
            minHeightClassName="min-h-0 h-full"
            className="border-x-0 border-b-0"
            placeholder={'{\n  "hello": "world"\n}'}
            extensions={jsonBodyExtensions}
            refreshKey={variableHighlightRefreshKey}
            onChange={value => updateRequestDraft({ ...draft, body: value }, 'request-body-raw')}
          />
        ) : null}

        {draft.bodyType === 'graphql' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 border-b border-base-content/10">
              <div className="border-b border-base-content/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55">
                Query
              </div>
              <CodeEditor
                value={draft.graphqlQuery}
                language="graphql"
                size="small"
                showLineNumbers
                minHeightClassName="min-h-0 h-full"
                className="border-x-0 border-b-0"
                placeholder={'query ExampleQuery {\n  viewer {\n    id\n  }\n}'}
                extensions={graphqlQueryExtensions}
                refreshKey={variableHighlightRefreshKey}
                onChange={value => updateRequestDraft({ ...draft, graphqlQuery: value }, 'request-body-graphql-query')}
              />
            </div>
            <div className="min-h-[180px] flex-1">
              <div className="border-b border-base-content/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-base-content/55">
                Variables
              </div>
              <CodeEditor
                value={draft.graphqlVariables}
                language="json5"
                size="small"
                showLineNumbers
                minHeightClassName="min-h-0 h-full"
                className="border-x-0 border-b-0"
                placeholder={'{\n  "id": "123"\n}'}
                extensions={graphqlVariablesExtensions}
                refreshKey={variableHighlightRefreshKey}
                onChange={value => updateRequestDraft({ ...draft, graphqlVariables: value }, 'request-body-graphql-variables')}
              />
            </div>
          </div>
        ) : null}

        {isParamBodyType(draft.bodyType) ? (
          <div className="min-h-0 flex-1 overflow-auto">
            <KeyValueEditor
              label={draft.bodyType === 'form-data' ? 'Form Data' : 'URL Encoded'}
              value={draft.body}
              onChange={value =>
                updateRequestDraft(
                  {
                    ...draft,
                    body: draft.bodyType === 'form-data' ? normalizeFormDataBody(value) : value,
                  },
                  'request-body-params'
                )
              }
              keyPlaceholder="key"
              valuePlaceholder={draft.bodyType === 'form-data' ? 'value or local file path' : 'value'}
              rowTypes={draft.bodyType === 'form-data' ? FORM_DATA_ROW_TYPES : undefined}
              onPickRowValue={draft.bodyType === 'form-data' ? pickFormDataFilePath : undefined}
            />
          </div>
        ) : null}

        {draft.bodyType === 'none' ? (
          <div className="flex min-h-0 h-full items-center justify-center bg-base-100/35 text-sm text-base-content/45">
            No request body
          </div>
        ) : null}
      </div>
    </section>
  )
}

function RequestBodyTabActions({
  draft,
  formatBody,
  isFetchingGraphqlSchema,
  onFetchGraphqlSchema,
  updateRequestDraft,
}: {
  draft: RequestDetailsDraft
  formatBody: () => Promise<void>
  isFetchingGraphqlSchema: boolean
  onFetchGraphqlSchema: () => Promise<void>
  updateRequestDraft: (nextDraft: RequestDetailsDraft, debugLabel?: string) => boolean
}) {
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const [bodyPreviewByExampleId, setBodyPreviewByExampleId] = useState<Record<string, string>>({})
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const requestBodyExamples = useMemo(
    () =>
      explorerItems.filter(
        (item): item is Extract<(typeof explorerItems)[number], { itemType: 'example' }> =>
          item.itemType === 'example' && item.requestId === selectedRequestId && item.responseStatus !== null
      ),
    [explorerItems, selectedRequestId]
  )

  useEffect(() => {
    if (requestBodyExamples.length === 0) {
      setBodyPreviewByExampleId({})
      return
    }

    let isCancelled = false

    void Promise.all(
      requestBodyExamples.map(async exampleItem => {
        const result = await getWindowElectron().getRequestExample({ id: exampleItem.id })
        if (!result.success) {
          return null
        }

        return [exampleItem.id, result.data.requestBodyType === 'graphql' ? (result.data.graphqlQuery ?? '') : result.data.requestBody] as const
      })
    ).then(entries => {
      if (isCancelled) {
        return
      }

      setBodyPreviewByExampleId(
        Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null))
      )
    })

    return () => {
      isCancelled = true
    }
  }, [requestBodyExamples])

  const bodyExampleOptions = useMemo(
    () =>
      requestBodyExamples.map(exampleItem => ({
        value: exampleItem.id,
        label: (
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,220px)] items-start gap-3">
            <span className="pt-0.5 text-[11px] leading-4 text-base-content">{exampleItem.name}</span>
            {bodyPreviewByExampleId[exampleItem.id] ? (
              <pre className="max-h-[84px] overflow-auto whitespace-pre-wrap break-all font-mono text-[9px] leading-3.5 text-base-content/75">
                {bodyPreviewByExampleId[exampleItem.id]}
              </pre>
            ) : null}
          </div>
        ),
        description: undefined,
      })),
    [bodyPreviewByExampleId, requestBodyExamples]
  )

  const applyRequestBodyExample = useCallback(
    async (exampleId: string) => {
      const result = await getWindowElectron().getRequestExample({ id: exampleId })
      if (!result.success) {
        toast.show(result)
        return
      }

      updateRequestDraft(
        {
          ...draft,
          body: result.data.requestBody,
          bodyType: result.data.requestBodyType,
          rawType: result.data.requestRawType,
          graphqlQuery: result.data.graphqlQuery ?? '',
          graphqlVariables: result.data.graphqlVariables ?? '',
        },
        'request-body-example-apply'
      )
    },
    [draft, updateRequestDraft]
  )

  const saveRequestBodyExample = useCallback(async () => {
    if (!selectedRequestId) {
      return
    }

    const exampleName = await dialogActions.promptText({
      title: 'Save body as example',
      message: 'Enter a name for this reusable request body.',
      defaultValue: draft.name ? `${draft.name} Body` : '',
      placeholder: 'Body example',
      confirmText: 'Save',
      cancelText: 'Cancel',
      required: true,
    })

    if (!exampleName) {
      return
    }

    const result = await getWindowElectron().createRequestExample({
      requestId: selectedRequestId,
      name: exampleName,
      requestHeaders: draft.headers,
      requestBody: draft.body,
      requestBodyType: draft.bodyType,
      requestRawType: draft.rawType,
      graphqlQuery: draft.graphqlQuery,
      graphqlVariables: draft.graphqlVariables,
      responseStatus: 200,
      responseStatusText: 'OK',
      responseHeaders: '',
      responseBody: '',
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    await FolderExplorerCoordinator.loadItems()
    toast.show({ severity: 'success', title: 'Example saved', message: 'Saved request body for reuse.' })
  }, [draft, selectedRequestId])

  return (
    <>
      {requestBodyExamples.length > 0 ? (
        <DropdownSelect
          value={REQUEST_BODY_EXAMPLE_PLACEHOLDER}
          className="w-[58px]"
          triggerClassName="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-2 text-xs font-medium"
          menuClassName="w-[420px]"
          options={bodyExampleOptions}
          placeholder={<LibraryBigIcon className="size-3.5 text-base-content" />}
          onChange={value => {
            if (value !== REQUEST_BODY_EXAMPLE_PLACEHOLDER) {
              void applyRequestBodyExample(value)
            }
          }}
          renderValue={() => <LibraryBigIcon className="size-3.5 text-base-content" />}
        />
      ) : null}
      <Tooltip content="Save body example" placement="left">
        <button
          type="button"
          className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-base-content/60 transition hover:bg-base-200/70 hover:text-base-content"
          onClick={() => void saveRequestBodyExample()}
          aria-label="Save body example"
        >
          <SaveIcon className="size-4" />
        </button>
      </Tooltip>
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
          updateRequestDraft(
            {
              ...draft,
              bodyType: value as RequestBodyType,
            },
            'request-body-type'
          )
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
          updateRequestDraft(
            {
              ...draft,
              rawType: value as RequestRawType,
            },
            'request-raw-type'
          )
        }
      />
      {(draft.bodyType === 'raw' && draft.rawType === 'json') || draft.bodyType === 'graphql' ? (
        <button
          type="button"
          className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase tracking-[0.08em] text-base-content transition hover:bg-base-200/70"
          onClick={() => void formatBody()}
        >
          Format
        </button>
      ) : null}
      {draft.bodyType === 'graphql' ? (
        <button
          type="button"
          className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase tracking-[0.08em] text-base-content transition hover:bg-base-200/70 disabled:cursor-wait disabled:opacity-60"
          onClick={() => void onFetchGraphqlSchema()}
          disabled={isFetchingGraphqlSchema}
        >
          {isFetchingGraphqlSchema ? 'Fetching...' : draft.graphqlSchema.trim() ? 'Refetch Schema' : 'Auto Fetch'}
        </button>
      ) : null}
    </>
  )
}

const FORM_DATA_ROW_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'file', label: 'File' },
] satisfies Array<{ value: 'text' | 'file'; label: string }>

const REQUEST_BODY_EXAMPLE_PLACEHOLDER = '__request-body-example-placeholder__'

function normalizeFormDataBody(value: string) {
  return stringifyKeyValueRows(
    parseKeyValueRows(value).map(row => ({ ...row, type: row.type === 'file' ? 'file' : 'text' }))
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
    <div data-testid="search-params-tab" data-context-scope="request-search-params">
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

function decodeSearchParamValue(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return null
  }
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

type PrettierGraphqlModule = {
  format: (source: string, options: { parser: 'graphql'; plugins: unknown[] }) => Promise<string> | string
}

let graphqlFormatterPromise: Promise<(value: string) => Promise<string>> | null = null

async function formatGraphqlQueryWithTemplates(value: string) {
  const format = await getGraphqlFormatter()
  const masked = maskGraphqlTemplateTokens(value)
  const formatted = await format(masked.value)

  return restoreGraphqlTemplateTokens(formatted, masked.tokens)
}

async function getGraphqlFormatter() {
  if (!graphqlFormatterPromise) {
    graphqlFormatterPromise = Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/graphql'),
    ]).then(([prettier, graphqlPlugin]) => {
      const standalonePrettier = prettier as PrettierGraphqlModule

      return async (value: string) => standalonePrettier.format(value, {
        parser: 'graphql',
        plugins: [graphqlPlugin.default],
      })
    })
  }

  return graphqlFormatterPromise
}

function maskGraphqlTemplateTokens(value: string) {
  const tokens: string[] = []

  return {
    value: value.replace(/\{\{[\s\S]*?\}\}/g, token => {
      const placeholder = `KOVA_GRAPHQL_TEMPLATE_TOKEN_${tokens.length}`
      tokens.push(token)
      return placeholder
    }),
    tokens,
  }
}

function restoreGraphqlTemplateTokens(value: string, tokens: string[]) {
  let restored = value

  for (const [index, token] of tokens.entries()) {
    restored = restored.replaceAll(`KOVA_GRAPHQL_TEMPLATE_TOKEN_${index}`, token)
  }

  return restored
}

function parseGraphqlSchema(value: string): GraphQLSchema | null {
  if (!value.trim()) {
    return null
  }

  try {
    return buildClientSchema(JSON.parse(value) as IntrospectionQuery)
  } catch {
    return null
  }
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
