import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronRightIcon, HistoryIcon, InfoIcon, PlayIcon, SquareIcon, Trash2Icon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { resolveEnvironmentVariables } from '@common/EnvironmentVariables'
import { buildEnvironmentVariableMap } from '@common/RequestVariables'
import { dialogActions } from '@/global/dialogStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { FolderDetailsDraft } from './folderExplorerTypes'
import { DetailsTextArea } from './DetailsTextArea'
import type { CodeEditorSelection } from './CodeEditor'
import { HeadersEditor } from './HeadersEditor'
import { AuthorizationEditor } from './AuthorizationEditor'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { scriptHoverExtension } from './codeEditorScriptHover'
import { supermavenGhostCompletionExtension } from './codeEditorSupermaven'
import { createTemplateCompletionSource, templateScriptExtension } from './codeEditorTemplateScript'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { getWindowElectron } from '@/getWindowElectron'
import { FolderRunCoordinator, folderRunStore } from './folderRunStore'
import { requestExecutionStore } from './requestExecutionStore'
import { parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { SharedScriptsSection } from './SharedScriptsSection'
import { useScriptPackageArtifacts } from './useScriptPackages'
import { useVisibleSharedScripts } from './useVisibleSharedScripts'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { buildHttpRequestPaths } from './folderExplorerUtils'
import { getFormatScriptBlocksOnSave } from '@/global/appSettingsStore'
import type { PendingScriptSelection } from './scriptFormatOnSave'
import { formatScriptValueForSave } from './scriptFormatOnSave'
import { ScriptAiIconButton } from './ScriptAiIconButton'
import type { FolderRequestRunConfig, FolderRunHistoryRecord, FolderRunRecord } from '@common/FolderRuns'
import type { ExplorerItem } from '@common/Explorer'
import type { RequestExecutionRecord, RequestScriptError } from '@common/Requests'
import { RequestExecutionDetails } from './RequestExecutionPanels'

const EMPTY_FOLDER_RUN_HISTORY: FolderRunHistoryRecord[] = []
const FOLDER_RUN_HISTORY_PAGE_SIZE = 4
const noopJumpToFolderRunScriptError = (_error: RequestScriptError) => undefined

type FolderRunHistoryListItem = {
  history: FolderRunHistoryRecord
  run: FolderRunRecord | null
  isLatest: boolean
}

export function FolderDetailsFields({ draft }: { draft: FolderDetailsDraft }) {
  const { artifacts: scriptPackageArtifacts } = useScriptPackageArtifacts()
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const selectedFolderId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'folder' ? state.context.selected.id : null
  )
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const historyKeepLast = useSelector(requestExecutionStore, state => state.context.historyKeepLast)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
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
        const nextDraft = environmentEntries[environment.id]?.current
        const variables = nextDraft?.variables ?? environment.variables
        return {
          id: environment.id,
          name: nextDraft?.name ?? environment.name,
          isActive: activeEnvironmentIds.includes(environment.id),
          priority: nextDraft?.priority ?? environment.priority,
          createdAt: environment.createdAt,
          valueByVariableName: new Map(
            Array.from(resolveEnvironmentVariables({ variables }).entries()).map(([key, row]) => [key, row.value])
          ),
        }
      }),
    [activeEnvironmentIds, environmentEntries, environments]
  )

  const variableAutocompleteItems = useMemo<VariableAutocompleteItem[]>(
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
  const { scripts: visibleSharedScripts, reload: reloadVisibleSharedScripts } =
    useVisibleSharedScripts(selectedFolderId)
  const visibleSharedScriptsRef = useRef(visibleSharedScripts)
  const scriptPackageArtifactsRef = useRef(scriptPackageArtifacts)
  const selectedFolderIdRef = useRef<string | null>(selectedFolderId)
  const preRequestSelectionRef = useRef<CodeEditorSelection | null>(null)
  const postRequestSelectionRef = useRef<CodeEditorSelection | null>(null)
  const pendingPreRequestSelectionRef = useRef<PendingScriptSelection | null>(null)
  const pendingPostRequestSelectionRef = useRef<PendingScriptSelection | null>(null)

  activeEnvironmentNamesRef.current = activeEnvironmentNames
  activeEnvironmentVariableNamesRef.current = activeEnvironmentVariableNames
  variableTooltipRowsRef.current = variableTooltipRows
  variableAutocompleteItemsRef.current = variableAutocompleteItems
  visibleSharedScriptsRef.current = visibleSharedScripts
  scriptPackageArtifactsRef.current = scriptPackageArtifacts
  selectedFolderIdRef.current = selectedFolderId

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
        getDocumentPath: () => `kova://folders/${selectedFolderIdRef.current ?? 'unknown'}/pre-request.ts`,
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
        getDocumentPath: () => `kova://folders/${selectedFolderIdRef.current ?? 'unknown'}/post-request.ts`,
        phase: 'post-request',
      }),
    ],
    []
  )

  const handleSaveWithFormatting = useCallback(async () => {
    let nextDraft = draft
    if (getFormatScriptBlocksOnSave()) {
      nextDraft = await formatFolderDraftScriptsForSave(
        draft,
        preRequestSelectionRef,
        postRequestSelectionRef,
        pendingPreRequestSelectionRef,
        pendingPostRequestSelectionRef
      )
      if (nextDraft !== draft) {
        FolderExplorerCoordinator.updateSelectedDraft(nextDraft)
      }
    }

    await FolderExplorerCoordinator.saveSelectedItemDirect({ skipFormatting: true })
  }, [draft])

  useEffect(() => {
    return FolderExplorerCoordinator.registerSelectedSaveHandler(handleSaveWithFormatting)
  }, [handleSaveWithFormatting])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="shrink-0">
        <DetailsTextArea
          label={null}
          value={draft.description}
          minHeightClassName="min-h-28"
          placeholder="Describe what this folder is for"
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, description: value })}
          onBlur={() => undefined}
        />

        {selectedFolderId ? (
          <FolderRunSection
            folderId={selectedFolderId}
            config={draft.runConfig}
            activeEnvironmentIds={activeEnvironmentIds}
            historyKeepLast={historyKeepLast}
            explorerItems={explorerItems}
            onChange={runConfig => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, runConfig })}
          />
        ) : null}

        <AuthorizationEditor
          value={draft.auth}
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, auth: value })}
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
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
        />
      </div>

      <div className="shrink-0 grid min-h-0 md:grid-cols-2">
        <DetailsTextArea
          label="Pre-request Script"
          value={draft.preRequestScript}
          minHeightClassName="min-h-[220px]"
          sectionClassName="flex min-h-0 flex-1 flex-col md:border-r md:border-base-content/10"
          editorLanguage="javascript"
          editorSize="small"
          extensions={preRequestScriptExtensions}
          externalSelection={
            pendingPreRequestSelectionRef.current?.code === draft.preRequestScript
              ? pendingPreRequestSelectionRef.current.selection
              : null
          }
          headerActions={
            <>
              <ScriptAiIconButton
                ownerType="folder"
                ownerId={selectedFolderId ?? ''}
                runtimeContext={{ phase: 'pre-request' }}
                currentCode={draft.preRequestScript}
                onApply={nextCode =>
                  FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: nextCode })
                }
              />
              <ScriptDocumentationButton phase="pre-request" />
            </>
          }
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
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
          minHeightClassName="min-h-[220px]"
          sectionClassName="flex min-h-0 flex-1 flex-col"
          editorLanguage="javascript"
          editorSize="small"
          extensions={postRequestScriptExtensions}
          externalSelection={
            pendingPostRequestSelectionRef.current?.code === draft.postRequestScript
              ? pendingPostRequestSelectionRef.current.selection
              : null
          }
          headerActions={
            <>
              <ScriptAiIconButton
                ownerType="folder"
                ownerId={selectedFolderId ?? ''}
                runtimeContext={{ phase: 'post-request' }}
                currentCode={draft.postRequestScript}
                onApply={nextCode =>
                  FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: nextCode })
                }
              />
              <ScriptDocumentationButton phase="post-request" />
            </>
          }
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
          onSelectionChange={selection => {
            postRequestSelectionRef.current = selection
            if (pendingPostRequestSelectionRef.current?.code === draft.postRequestScript) {
              pendingPostRequestSelectionRef.current = null
            }
          }}
          onBlur={() => undefined}
        />
      </div>

      {selectedFolderId ? (
        <div className="shrink-0">
          <DetailsSectionHeader title="Folder Shared Scripts" />

          <div className="h-[500px] min-h-[500px]">
            <SharedScriptsSection
              title=""
              description=""
              scopeType="folder"
              scopeId={selectedFolderId}
              visibleSharedScripts={visibleSharedScripts}
              onScriptsChanged={() => void reloadVisibleSharedScripts()}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

async function formatFolderDraftScriptsForSave(
  draft: FolderDetailsDraft,
  preRequestSelectionRef: { current: CodeEditorSelection | null },
  postRequestSelectionRef: { current: CodeEditorSelection | null },
  pendingPreRequestSelectionRef: { current: { selection: CodeEditorSelection; code: string } | null },
  pendingPostRequestSelectionRef: { current: { selection: CodeEditorSelection; code: string } | null }
) {
  let changed = false

  const preRequestScript = await formatFolderScriptValueWithSelection(
    draft.preRequestScript,
    preRequestSelectionRef.current,
    pendingPreRequestSelectionRef
  )
  changed = changed || preRequestScript !== draft.preRequestScript

  const postRequestScript = await formatFolderScriptValueWithSelection(
    draft.postRequestScript,
    postRequestSelectionRef.current,
    pendingPostRequestSelectionRef
  )
  changed = changed || postRequestScript !== draft.postRequestScript

  if (!changed) {
    return draft
  }

  return {
    ...draft,
    preRequestScript,
    postRequestScript,
  }
}

async function formatFolderScriptValueWithSelection(
  value: string,
  selection: CodeEditorSelection | null,
  pendingSelectionRef: { current: PendingScriptSelection | null }
) {
  return formatScriptValueForSave(value, selection, pendingSelectionRef, 'Folder script')
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

function FolderRunSection({
  folderId,
  config,
  activeEnvironmentIds,
  historyKeepLast,
  explorerItems,
  onChange,
}: {
  folderId: string
  config: FolderRequestRunConfig
  activeEnvironmentIds: string[]
  historyKeepLast: number
  explorerItems: ExplorerItem[]
  onChange: (config: FolderRequestRunConfig) => void
}) {
  const activeRunId = useSelector(folderRunStore, state => state.context.activeRunIdByFolderId[folderId] ?? null)
  const latestRunId = useSelector(folderRunStore, state => state.context.latestRunIdByFolderId[folderId] ?? null)
  const runsById = useSelector(folderRunStore, state => state.context.runsById)
  const history = useSelector(
    folderRunStore,
    state => state.context.historyByFolderId[folderId] ?? EMPTY_FOLDER_RUN_HISTORY
  )
  const isHistoryLoading = useSelector(
    folderRunStore,
    state => state.context.historyLoadingByFolderId[folderId] ?? false
  )
  const descendantRequests = useDescendantHttpRequests(folderId, explorerItems)
  const [testedRequestIds, setTestedRequestIds] = useState<Set<string>>(new Set())
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set())
  const [loadedHistoryRunsById, setLoadedHistoryRunsById] = useState<Record<string, FolderRunRecord>>({})
  const [loadingHistoryRunIds, setLoadingHistoryRunIds] = useState<Set<string>>(new Set())
  const [historyPage, setHistoryPage] = useState(0)
  const isRunning = activeRunId !== null
  const historyItems = useMemo(
    () => buildFolderRunHistoryItems(folderId, history, runsById, latestRunId),
    [folderId, history, latestRunId, runsById]
  )
  const historyPageCount = Math.max(1, Math.ceil(historyItems.length / FOLDER_RUN_HISTORY_PAGE_SIZE))
  const paginatedHistoryItems = historyItems.slice(
    historyPage * FOLDER_RUN_HISTORY_PAGE_SIZE,
    historyPage * FOLDER_RUN_HISTORY_PAGE_SIZE + FOLDER_RUN_HISTORY_PAGE_SIZE
  )

  useEffect(() => {
    void FolderRunCoordinator.loadHistory(folderId)
  }, [folderId])

  useEffect(() => {
    setExpandedRunIds(new Set())
    setHistoryPage(0)
  }, [folderId])

  useEffect(() => {
    setHistoryPage(current => Math.min(current, historyPageCount - 1))
  }, [historyPageCount])

  useEffect(() => {
    if (!latestRunId) {
      return
    }

    setExpandedRunIds(current => {
      if (current.has(latestRunId)) {
        return current
      }

      return new Set(current).add(latestRunId)
    })
  }, [latestRunId])

  useEffect(() => {
    let cancelled = false
    void Promise.all(
      descendantRequests.map(async request => {
        const result = await getWindowElectron().getRequest({ id: request.id })
        if (!result.success) return null
        if (result.data.testScript.trim()) return request.id
        const scripts = await getWindowElectron().listVisibleSharedScripts({ folderId: request.parentFolderId })
        return scripts.some(script => script.targets.includes('test') && script.isActive && script.code.trim())
          ? request.id
          : null
      })
    ).then(ids => {
      if (!cancelled) {
        setTestedRequestIds(new Set(ids.filter((id): id is string => id !== null)))
      }
    })

    return () => {
      cancelled = true
    }
  }, [descendantRequests])

  const updateConfig = (patch: Partial<FolderRequestRunConfig>) => {
    onChange({ ...config, ...patch })
  }

  const runFolder = async () => {
    await FolderRunCoordinator.startRun({ folderId, config, activeEnvironmentIds, historyKeepLast })
  }

  const deleteHistoryRun = async (runId: string) => {
    await FolderRunCoordinator.deleteHistoryEntry(folderId, runId)
    setExpandedRunIds(current => {
      const next = new Set(current)
      next.delete(runId)
      return next
    })
    setLoadingHistoryRunIds(current => {
      const next = new Set(current)
      next.delete(runId)
      return next
    })
    setLoadedHistoryRunsById(current => {
      const next = { ...current }
      delete next[runId]
      return next
    })
  }

  const toggleHistoryRun = async (item: FolderRunHistoryListItem) => {
    const shouldExpand = !expandedRunIds.has(item.history.id)
    setExpandedRunIds(current => {
      const next = new Set(current)
      if (shouldExpand) {
        next.add(item.history.id)
      } else {
        next.delete(item.history.id)
      }
      return next
    })

    if (
      !shouldExpand ||
      item.run ||
      loadedHistoryRunsById[item.history.id] ||
      loadingHistoryRunIds.has(item.history.id)
    ) {
      return
    }

    setLoadingHistoryRunIds(current => new Set(current).add(item.history.id))
    const result = await getWindowElectron().getFolderRunHistory({ id: item.history.id })
    setLoadingHistoryRunIds(current => {
      const next = new Set(current)
      next.delete(item.history.id)
      return next
    })

    if (!result.success) {
      return
    }

    setLoadedHistoryRunsById(current => ({
      ...current,
      [result.data.run.id]: buildFolderRunRecordFromHistory(result.data.run, result.data.requests),
    }))
  }

  return (
    <section className="border-y border-base-content/10 bg-base-100/55">
      <DetailsSectionHeader title="Folder Run" />

      <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid gap-1 text-xs font-medium text-base-content/60">
          Requests
          <select
            className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none"
            value={config.selectionMode}
            onChange={event =>
              updateConfig({ selectionMode: event.target.value as FolderRequestRunConfig['selectionMode'] })
            }
          >
            <option value="all">All requests</option>
            <option value="tests-only">Only with tests</option>
            <option value="custom">Custom selection</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-base-content/60">
          Execution
          <select
            className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none"
            value={config.executionMode}
            onChange={event =>
              updateConfig({ executionMode: event.target.value as FolderRequestRunConfig['executionMode'] })
            }
          >
            <option value="sequential">Sequential</option>
            <option value="parallel">Parallel</option>
          </select>
        </label>
        <label className="flex items-end gap-2 rounded-xl bg-base-100 px-3 py-2 text-sm text-base-content/70">
          <input
            type="checkbox"
            className="checkbox checkbox-sm rounded-none"
            checked={config.continueOnFailure}
            onChange={event => updateConfig({ continueOnFailure: event.target.checked })}
          />
          Continue on failure
        </label>
        <div className="flex items-end justify-end">
          {isRunning && activeRunId ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-error/25 bg-error/10 px-3 py-2 text-xs font-semibold text-error transition hover:bg-error/15"
              onClick={() => void FolderRunCoordinator.cancelRun(activeRunId)}
            >
              <SquareIcon className="size-3.5" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-success/25 bg-success/12 px-3 py-2 text-xs font-semibold text-success transition hover:bg-success/18"
              onClick={() => void runFolder()}
            >
              <PlayIcon className="size-3.5" />
              Run
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        {config.selectionMode === 'custom' ? (
          <CustomFolderRunSelection
            requests={descendantRequests}
            testedRequestIds={testedRequestIds}
            selectedRequestIds={config.selectedRequestIds}
            onChange={selectedRequestIds => updateConfig({ selectedRequestIds })}
          />
        ) : null}

        <div className="mt-4 rounded-2xl border border-base-content/10 bg-base-100/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-content/45">
            <HistoryIcon className="size-3.5" />
            Run History
          </div>
          {isHistoryLoading ? <div className="text-sm text-base-content/45">Loading runs...</div> : null}
          {!isHistoryLoading && historyItems.length === 0 ? (
            <div className="text-sm text-base-content/45">No folder runs yet.</div>
          ) : null}
          <div className="grid gap-2">
            {paginatedHistoryItems.map(item => (
              <FolderRunHistoryItem
                key={item.history.id}
                item={item}
                loadedRun={loadedHistoryRunsById[item.history.id] ?? null}
                expanded={expandedRunIds.has(item.history.id)}
                loading={loadingHistoryRunIds.has(item.history.id)}
                onToggle={() => void toggleHistoryRun(item)}
                onDelete={() => void deleteHistoryRun(item.history.id)}
                canDelete={item.history.status !== 'running' && activeRunId !== item.history.id}
              />
            ))}
          </div>
          {historyItems.length > FOLDER_RUN_HISTORY_PAGE_SIZE ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-base-content/45">
              <span>
                Page {historyPage + 1} of {historyPageCount}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-base-content/10 px-3 py-1.5 font-medium text-base-content/60 transition hover:bg-base-200/60 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setHistoryPage(current => Math.max(0, current - 1))}
                  disabled={historyPage === 0}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-base-content/10 px-3 py-1.5 font-medium text-base-content/60 transition hover:bg-base-200/60 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => setHistoryPage(current => Math.min(historyPageCount - 1, current + 1))}
                  disabled={historyPage === historyPageCount - 1}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function CustomFolderRunSelection({
  requests,
  testedRequestIds,
  selectedRequestIds,
  onChange,
}: {
  requests: Array<Extract<ExplorerItem, { itemType: 'request' }>>
  testedRequestIds: Set<string>
  selectedRequestIds: string[]
  onChange: (ids: string[]) => void
}) {
  const selected = new Set(selectedRequestIds)
  const setSelected = (id: string, checked: boolean) => {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onChange(Array.from(next))
  }

  return (
    <div className="mt-4 rounded-2xl border border-base-content/10 bg-base-100/60 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/45">Custom Requests</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-medium text-base-content/55 hover:text-base-content"
            onClick={() => onChange(requests.map(request => request.id))}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-xs font-medium text-base-content/55 hover:text-base-content"
            onClick={() =>
              onChange(requests.filter(request => testedRequestIds.has(request.id)).map(request => request.id))
            }
          >
            Select tested
          </button>
          <button
            type="button"
            className="text-xs font-medium text-base-content/55 hover:text-base-content"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-56 overflow-auto">
        {requests.map(request => (
          <label
            key={request.id}
            className="flex items-center gap-3 border-t border-base-content/8 px-1 py-2 text-sm first:border-t-0"
          >
            <input
              type="checkbox"
              className="checkbox checkbox-sm rounded-none"
              checked={selected.has(request.id)}
              onChange={event => setSelected(request.id, event.target.checked)}
            />
            <span className="w-14 shrink-0 text-xs font-semibold text-info">{request.method}</span>
            <span className="min-w-0 flex-1 truncate text-base-content">{request.name}</span>
            {testedRequestIds.has(request.id) ? (
              <span className="rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success">Tests</span>
            ) : null}
          </label>
        ))}
      </div>
    </div>
  )
}

function FolderRunHistoryItem({
  item,
  loadedRun,
  expanded,
  loading,
  onToggle,
  onDelete,
  canDelete,
}: {
  item: FolderRunHistoryListItem
  loadedRun: FolderRunRecord | null
  expanded: boolean
  loading: boolean
  onToggle: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const run = item.run ?? loadedRun

  return (
    <div className="overflow-hidden rounded-xl border border-base-content/8 bg-base-100 text-sm">
      <div className="flex items-start gap-2 px-3 py-2 transition hover:bg-base-200/35">
        <button type="button" className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={onToggle}>
          <span className="mt-0.5 shrink-0 text-base-content/45">
            {expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-medium text-base-content">{item.history.status}</span>
                {item.isLatest ? (
                  <span className="rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-medium text-info">Latest</span>
                ) : null}
              </div>
              <span className="text-xs text-base-content/45">{new Date(item.history.startedAt).toLocaleString()}</span>
            </div>
            <div className="mt-1 text-xs text-base-content/55">
              {item.history.passedRequestCount}/{item.history.requestCount} requests passed, {item.history.failedRequestCount}{' '}
              failed
            </div>
          </div>
        </button>
        {canDelete ? (
          <button
            type="button"
            className="mt-0.5 rounded-lg p-2 text-base-content/35 transition hover:bg-error/10 hover:text-error"
            onClick={event => {
              event.stopPropagation()
              void onDelete()
            }}
            aria-label="Delete folder run"
            title="Delete folder run"
          >
            <Trash2Icon className="size-4" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-base-content/8 px-3 pb-3 pt-3">
          {loading ? <div className="text-sm text-base-content/45">Loading run details...</div> : null}
          {!loading && run ? <FolderRunDetails run={run} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function FolderRunDetails({ run }: { run: FolderRunRecord }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold text-base-content">Run Details</div>
        <div className="text-xs text-base-content/45">{run.summary.durationMs ?? 0} ms</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <FolderRunMetric label="Requests" value={`${run.summary.passedRequestCount}/${run.summary.requestCount}`} />
        <FolderRunMetric label="Failed" value={run.summary.failedRequestCount} tone="text-error" />
        <FolderRunMetric
          label="Tests"
          value={`${run.summary.passedTestCount}/${run.summary.totalTestCount}`}
          tone="text-success"
        />
        <FolderRunMetric label="Running" value={run.summary.runningRequestCount} tone="text-info" />
      </div>
      <div className="mt-3 grid gap-2">
        {run.requests.map(request => (
          <FolderRunRequestResult key={request.requestId} request={request} />
        ))}
      </div>
    </div>
  )
}

function buildFolderRunHistoryItems(
  folderId: string,
  history: FolderRunHistoryRecord[],
  runsById: Record<string, FolderRunRecord>,
  latestRunId: string | null
): FolderRunHistoryListItem[] {
  const liveRuns = Object.values(runsById)
    .filter(run => run.folderId === folderId)
    .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
  const liveRunIds = new Set(liveRuns.map(run => run.id))

  return [
    ...liveRuns.map(run => ({ history: buildFolderRunHistoryRecord(run), run, isLatest: run.id === latestRunId })),
    ...history
      .filter(item => !liveRunIds.has(item.id))
      .map(item => ({ history: item, run: null, isLatest: item.id === latestRunId })),
  ]
}

function buildFolderRunHistoryRecord(run: FolderRunRecord): FolderRunHistoryRecord {
  return {
    id: run.id,
    folderId: run.folderId,
    folderName: run.folderName,
    config: run.config,
    status: run.status,
    summary: run.summary,
    requestCount: run.summary.requestCount,
    passedRequestCount: run.summary.passedRequestCount,
    failedRequestCount: run.summary.failedRequestCount,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  }
}

function buildFolderRunRecordFromHistory(
  run: FolderRunHistoryRecord,
  executions: RequestExecutionRecord[]
): FolderRunRecord {
  return {
    id: run.id,
    folderId: run.folderId,
    folderName: run.folderName,
    config: run.config,
    status: run.status,
    summary: run.summary,
    requests: executions.map((execution, index) => ({
      requestId: execution.requestId,
      requestName: execution.requestName,
      method: execution.request.method,
      url: execution.request.url,
      position: index,
      hasTests: execution.testRun !== null,
      status:
        execution.responseError || execution.scriptErrors.length > 0 || (execution.testRun?.failedCount ?? 0) > 0
          ? 'failed'
          : 'passed',
      execution,
      error: execution.responseError,
      startedAt: execution.request.sentAt,
      completedAt: execution.response?.receivedAt ?? null,
    })),
    overlappingFolderRunIds: [],
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  }
}

function FolderRunRequestResult({ request }: { request: FolderRunRecord['requests'][number] }) {
  const [expanded, setExpanded] = useState(request.status === 'failed')
  const [responseBodyExpanded, setResponseBodyExpanded] = useState(true)
  const execution = request.execution
  const hasDetails = execution !== null

  return (
    <div className="rounded-xl border border-base-content/8 bg-base-100 text-sm">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left transition hover:bg-base-200/35"
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
        <span className="text-xs font-semibold text-info">{request.method}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-base-content">{request.requestName}</span>
        {execution?.testRun ? (
          <span className="text-xs text-base-content/45">
            {execution.testRun.passedCount}/{execution.testRun.totalCount} tests passed
          </span>
        ) : null}
        <span className={getRunStatusClassName(request.status)}>{request.status}</span>
      </button>

      {expanded && hasDetails ? (
        <div className="border-t border-base-content/8 px-3 pb-3 pt-2">
          <RequestExecutionDetails
            execution={execution}
            onJumpToScriptError={noopJumpToFolderRunScriptError}
            responseBodyExpanded={responseBodyExpanded}
            onToggleResponseBody={() => setResponseBodyExpanded(current => !current)}
          />
        </div>
      ) : null}
    </div>
  )
}

function FolderRunMetric({
  label,
  value,
  tone = 'text-base-content',
}: {
  label: string
  value: string | number
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-base-content/8 bg-base-100 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-base-content/40">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function useDescendantHttpRequests(folderId: string, items: ExplorerItem[]) {
  return useMemo(() => {
    const folderIds = new Set<string>([folderId])
    let changed = true
    while (changed) {
      changed = false
      for (const item of items) {
        if (
          item.itemType === 'folder' &&
          item.parentFolderId &&
          folderIds.has(item.parentFolderId) &&
          !folderIds.has(item.id)
        ) {
          folderIds.add(item.id)
          changed = true
        }
      }
    }
    return items
      .filter(
        (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
          item.itemType === 'request' &&
          item.requestType === 'http' &&
          item.parentFolderId !== null &&
          folderIds.has(item.parentFolderId)
      )
      .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)
  }, [folderId, items])
}

function getRunStatusClassName(status: FolderRunRecord['requests'][number]['status']) {
  if (status === 'passed') return 'rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-medium text-success'
  if (status === 'failed') return 'rounded-full bg-error/12 px-2 py-0.5 text-[11px] font-medium text-error'
  if (status === 'running') return 'rounded-full bg-info/12 px-2 py-0.5 text-[11px] font-medium text-info'
  if (status === 'cancelled' || status === 'skipped')
    return 'rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-medium text-warning'
  return 'rounded-full bg-base-content/8 px-2 py-0.5 text-[11px] font-medium text-base-content/50'
}

function updateEnvironmentVariableDraft(environmentId: string, variableName: string, value: string) {
  const state = environmentEditorStore.getSnapshot().context
  const entry = state.entries[environmentId]
  if (!entry?.current) {
    return
  }

  const rows = parseKeyValueRows(entry.current.variables)
  const row = rows.find(currentRow => currentRow.key.trim() === variableName)

  const nextVariables = row
    ? stringifyKeyValueRows(
        rows.map(currentRow => (currentRow.key.trim() === variableName ? { ...currentRow, value } : currentRow))
      )
    : entry.current.variables

  environmentEditorStore.trigger.draftUpdated({
    id: environmentId,
    draft: {
      ...entry.current,
      variables: nextVariables,
    },
  })
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
