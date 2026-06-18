import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import { Columns2Icon, Edit2Icon, FileCode2Icon, InfoIcon, KeyboardIcon, LoaderCircleIcon, PlayIcon, PlusIcon, Rows3Icon, SaveIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { getScriptAiTargetKey } from '@common/ScriptAi'
import type { ExplorerItem, ExplorerRequestItem } from '@common/Explorer'
import { parseKeyValueRows } from '@common/KeyValueRows'
import { Typescript } from '@common/Typescript'
import type { ViewLayoutMode, ViewRecord, ViewShortcut } from '@common/Views'
import { getWindowElectron } from '@/getWindowElectron'
import { appSettingsStore, getFormatScriptBlocksOnSave } from '@/global/appSettingsStore'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { toast } from '@/lib/components/toast'
import { useShortcutRecorder } from '@/lib/hooks/useShortcutRecorder'
import { Tooltip } from '../components/Tooltip'
import { ShortcutDisplay } from '../components/ShortcutDisplay'
import { CodeEditor, type CodeEditorHandle, type CodeEditorSelection } from './CodeEditor'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { scriptHoverExtension } from './codeEditorScriptHover'
import { supermavenGhostCompletionExtension } from './codeEditorSupermaven'
import { environmentEditorStore } from './environmentEditorStore'
import { formatScriptBlockWithCursor } from './formatScriptBlock'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { buildHttpRequestPaths } from './folderExplorerUtils'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { openScriptAiReviewDialog } from './ScriptAiReviewDialog'
import { isScriptAiReviewEntryBusy, scriptAiReviewStore, ScriptAiReviewCoordinator } from './scriptAiReviewStore'
import { useScriptPackageArtifacts } from './useScriptPackages'
import { useViews, notifyViewsChanged } from './useViews'
import { ViewUiHelpers, viewUiStore } from './viewUiStore'
import { useVisibleSharedScripts } from './useVisibleSharedScripts'
import { ViewRuntimePreview } from './ViewRuntimePreview'

type ViewEditorEntry = {
  saved: ViewRecord
  current: ViewRecord
  isDirty: boolean
  saving: boolean
}

type ViewLayoutChoice = 'stacked' | 'side-by-side' | 'only-code' | 'only-view'

const MIN_VIEW_SPLIT_RATIO = 15
const MAX_VIEW_SPLIT_RATIO = 85

export function ViewsPanel() {
  const { items, loading, reload } = useViews()
  const treeItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const environmentItems = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const { artifacts: scriptPackageArtifacts } = useScriptPackageArtifacts()
  const { scripts: visibleSharedScripts } = useVisibleSharedScripts(null)
  const [entries, setEntries] = useState<Record<string, ViewEditorEntry>>({})
  const [isResizing, setIsResizing] = useState(false)
  const selectedId = useSelector(viewUiStore, state => state.context.selectedId)
  const pendingRunRequest = useSelector(viewUiStore, state => state.context.pendingRunRequest)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{
    viewId: string
    layoutMode: ViewLayoutMode
    startRatio: number
    startX: number
    startY: number
  } | null>(null)
  const viewEditorRef = useRef<CodeEditorHandle | null>(null)
  const viewSelectionRef = useRef<CodeEditorSelection | null>(null)
  const pendingSelectionRestoreRef = useRef<{ viewId: string; selection: CodeEditorSelection; code: string } | null>(
    null
  )

  const sharedScriptsRef = useRef(visibleSharedScripts)
  const scriptPackageArtifactsRef = useRef(scriptPackageArtifacts)
  const environmentNamesRef = useRef<string[]>([])
  const variableNamesRef = useRef<string[]>([])
  const selectedViewIdRef = useRef<string | null>(selectedId)
  const entriesRef = useRef<Record<string, ViewEditorEntry>>({})

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    selectedViewIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    sharedScriptsRef.current = visibleSharedScripts
  }, [visibleSharedScripts])

  useEffect(() => {
    scriptPackageArtifactsRef.current = scriptPackageArtifacts
  }, [scriptPackageArtifacts])

  const runtimeEnvironments = useMemo(
    () =>
      environmentItems.map(environment => {
        const draft = environmentEntries[environment.id]?.current
        const values = parseEnvironmentValues(draft?.variables ?? environment.variables)
        return {
          id: environment.id,
          name: draft?.name ?? environment.name,
          isActive: activeEnvironmentIds.includes(environment.id),
          priority: draft?.priority ?? environment.priority,
          createdAt: environment.createdAt,
          values,
        }
      }),
    [activeEnvironmentIds, environmentEntries, environmentItems]
  )

  useEffect(() => {
    environmentNamesRef.current = runtimeEnvironments.map(environment => environment.name)
    variableNamesRef.current = Array.from(
      new Set(runtimeEnvironments.flatMap(environment => Object.keys(environment.values).filter(Boolean)))
    ).sort((left, right) => left.localeCompare(right))
  }, [runtimeEnvironments])

  useEffect(() => {
    setEntries(currentEntries => {
      const nextEntries: Record<string, ViewEditorEntry> = {}

      for (const item of items) {
        const normalizedItem = normalizeViewRecord(item)
        const currentEntry = currentEntries[item.id]
        if (currentEntry?.isDirty) {
          nextEntries[item.id] = {
            ...currentEntry,
            saved: normalizedItem,
            current: normalizeViewRecord(currentEntry.current),
            isDirty: serializeViewDraft(currentEntry.current) !== serializeViewDraft(normalizedItem),
          }
          continue
        }

        nextEntries[item.id] = {
          saved: normalizedItem,
          current: normalizedItem,
          isDirty: false,
          saving: currentEntry?.saving ?? false,
        }
      }

      return nextEntries
    })
  }, [items])

  useEffect(() => {
    if (loading) {
      return
    }

    if (items.length === 0) {
      if (selectedId !== null) {
        ViewUiHelpers.selectView(null)
      }
      return
    }

    if (!selectedId || !items.some(item => item.id === selectedId)) {
      ViewUiHelpers.selectView(items[0]?.id ?? null)
    }
  }, [items, selectedId])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const resizeState = resizeStateRef.current
      const container = splitContainerRef.current
      if (!resizeState || !container) {
        return
      }

      const rect = container.getBoundingClientRect()
      const nextRatio =
        resizeState.layoutMode === 'horizontal'
          ? resizeState.startRatio + ((event.clientX - resizeState.startX) / Math.max(rect.width, 1)) * 100
          : resizeState.startRatio + ((event.clientY - resizeState.startY) / Math.max(rect.height, 1)) * 100

      updateDraft(resizeState.viewId, draft => ({ ...draft, splitRatio: clampSplitRatio(nextRatio) }))
    }

    const handleMouseUp = () => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }

      resizeStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      const draft = entries[resizeState.viewId]?.current
      if (draft) {
        void saveView(resizeState.viewId, draft)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [entries])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        void saveView(selectedId)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        ViewUiHelpers.requestRun(selectedId)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [selectedId])

  const selectedEntry = selectedId ? (entries[selectedId] ?? null) : null
  const selectedDraft = selectedEntry?.current ?? null
  const selectedSavedView = selectedEntry?.saved ?? null
  const selectedRunRequestId =
    selectedDraft && pendingRunRequest?.viewId === selectedDraft.id ? pendingRunRequest.requestId : null
  const appDefaultModel = useSelector(appSettingsStore, state => state.context.settings?.scriptAiModel ?? null)
  const viewScriptAiTargetKey = selectedDraft
    ? getScriptAiTargetKey({ ownerType: 'view', ownerId: selectedDraft.id, runtimeContext: { phase: 'view-runtime' } })
    : null
  const viewScriptAiEntry = useSelector(scriptAiReviewStore, state =>
    viewScriptAiTargetKey ? (state.context.entriesByTargetKey[viewScriptAiTargetKey] ?? null) : null
  )
  const isViewScriptAiBusy = isScriptAiReviewEntryBusy(viewScriptAiEntry)

  useEffect(() => {
    const pendingSelectionRestore = pendingSelectionRestoreRef.current
    if (!pendingSelectionRestore || !selectedId || pendingSelectionRestore.viewId !== selectedId) {
      return
    }

    if (selectedDraft?.code !== pendingSelectionRestore.code) {
      return
    }

    pendingSelectionRestoreRef.current = null
  }, [selectedDraft?.code, selectedId])

  useEffect(() => {
    if (!selectedDraft) {
      return
    }

    ScriptAiReviewCoordinator.registerTarget({
      target: {
        ownerType: 'view',
        ownerId: selectedDraft.id,
        runtimeContext: { phase: 'view-runtime' },
      },
      currentCode: selectedDraft.code,
      onApply: async (nextCode, options) => {
        const nextDraft = { ...selectedDraft, code: nextCode }
        updateDraft(selectedDraft.id, () => nextDraft)
        return saveView(selectedDraft.id, nextDraft, options)
      },
      defaultModel: appDefaultModel,
    })
  }, [appDefaultModel, selectedDraft])

  const runtimeSharedScripts = useMemo(
    () => visibleSharedScripts.filter(script => script.targets.includes('view-runtime')),
    [visibleSharedScripts]
  )
  const requestPaths = useMemo(() => buildViewRequestPaths(treeItems), [treeItems])

  const viewRuntimeExtensions = useMemo(
    () => [
      scriptDiagnosticsExtension({
        phase: 'view-runtime',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => sharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptAutocompleteExtension({
        phase: 'view-runtime',
        includeResponse: false,
        getEnvironmentNames: () => environmentNamesRef.current,
        getVariableNames: () => variableNamesRef.current,
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => sharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      scriptHoverExtension({
        phase: 'view-runtime',
        getRequestPaths: () => buildHttpRequestPaths(folderExplorerTreeStore.getSnapshot().context.items),
        getSharedScripts: () => sharedScriptsRef.current,
        getPackages: () => scriptPackageArtifactsRef.current,
      }),
      supermavenGhostCompletionExtension({
        getDocumentPath: () => `kova://views/${selectedViewIdRef.current ?? 'unknown'}/view-runtime.tsx`,
        phase: 'view-runtime',
      }),
    ],
    []
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-base-100">
      <aside className="flex h-full w-[320px] min-w-[320px] flex-col border-r border-base-content/10 bg-base-100">
        <div className="border-b border-base-content/10 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-base-content">Views</div>
            </div>
            <button
              type="button"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 px-3 text-sm font-medium text-base-content transition hover:border-base-content/20 hover:bg-base-200/70"
              onClick={() => void createView()}
            >
              <PlusIcon className="mr-2 size-4" />
              New
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {loading ? <PanelEmptyState message="Loading views..." /> : null}
          {!loading && items.length === 0 ? <PanelEmptyState message="Create a view to start building flows." /> : null}

          <div className="space-y-2">
            {items.map(item => {
              const entry = entries[item.id]
              const isActive = item.id === selectedId
              return (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    'flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition',
                    isActive
                      ? 'border-primary/35 bg-primary/8 text-base-content'
                      : 'border-base-content/10 bg-base-100 hover:border-base-content/20 hover:bg-base-200/40',
                  ].join(' ')}
                  onClick={() => ViewUiHelpers.selectView(item.id)}
                >
                  <div className="min-w-0 flex-1">
                     <div className="truncate text-sm font-medium">{entry?.current.name || item.name}</div>
                     <div className="mt-1 text-xs text-base-content/45">
                      {getViewLayoutChoiceLabel(getViewLayoutChoice(entry?.current ?? item))}
                      {' · '}
                      {entry?.current.rememberRequests ? 'Remembering requests' : 'Live requests'}
                    </div>
                  </div>
                  {entry?.isDirty ? <span className="mt-1 size-2 rounded-full bg-warning" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!selectedDraft ? (
          <div className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-base-content/45">
            Select a view to edit and save it.
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b border-base-content/10 pr-4">
              <input
                value={selectedDraft.name}
                onChange={event => updateDraft(selectedDraft.id, draft => ({ ...draft, name: event.target.value }))}
                placeholder="View name"
                className="min-w-0 flex-1 bg-base-100 px-3 py-2 text-sm text-base-content outline-none transition focus:border-base-content/25"
              />

              <label className="flex items-center gap-2 text-xs text-base-content/65">
                Remember Requests
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={selectedDraft.rememberRequests}
                  onChange={event => {
                    const nextDraft = { ...selectedDraft, rememberRequests: event.target.checked }
                    updateDraft(selectedDraft.id, () => nextDraft)
                    void saveView(selectedDraft.id, nextDraft)
                  }}
                />
              </label>

              <ViewShortcutEditor
                shortcut={selectedDraft.shortcut}
                onChange={shortcut => {
                  const nextDraft = { ...selectedDraft, shortcut }
                  updateDraft(selectedDraft.id, () => nextDraft)
                  void saveView(selectedDraft.id, nextDraft)
                }}
              />

              <ViewLayoutChooser
                value={getViewLayoutChoice(selectedDraft)}
                onChange={choice => {
                  const nextDraft = applyViewLayoutChoice(selectedDraft, choice)
                  updateDraft(selectedDraft.id, () => nextDraft)
                  void saveView(selectedDraft.id, nextDraft)
                }}
              />

              <ToolbarButton label="Documentation" onClick={() => openDocumentation()}>
                <InfoIcon className="size-4" />
              </ToolbarButton>

              <ToolbarButton
                label={selectedDraft.code.trim() ? 'Update with AI' : 'Generate with AI'}
                onClick={() =>
                    openScriptAiReviewDialog({
                      target: {
                         ownerType: 'view',
                         ownerId: selectedDraft.id,
                         runtimeContext: { phase: 'view-runtime' },
                       },
                       currentCode: selectedDraft.code,
                        onApply: async (nextCode, options) => {
                          const nextDraft = { ...selectedDraft, code: nextCode }
                          updateDraft(selectedDraft.id, () => nextDraft)
                          return saveView(selectedDraft.id, nextDraft, options)
                        },
                    })
                 }
              >
                <span className="relative inline-flex size-4 items-center justify-center">
                  <SparklesIcon className="size-4" />
                  {isViewScriptAiBusy ? (
                    <span className="pointer-events-none absolute -bottom-1 -right-1 rounded-full bg-base-100/90 text-primary shadow-sm">
                      <LoaderCircleIcon className="size-3 animate-spin" />
                    </span>
                  ) : null}
                </span>
              </ToolbarButton>

              <ToolbarButton
                label="Save"
                onClick={() => void saveView(selectedDraft.id)}
                disabled={!selectedEntry?.isDirty || selectedEntry.saving}
              >
                <SaveIcon className="size-4" />
              </ToolbarButton>

              <ToolbarButton label="Run runner" onClick={() => ViewUiHelpers.requestRun(selectedDraft.id)}>
                <PlayIcon className="size-4" />
              </ToolbarButton>

              <ToolbarButton label="Delete" onClick={() => void deleteView(selectedDraft.id)}>
                <Trash2Icon className="size-4" />
              </ToolbarButton>
            </header>

            <div
              ref={splitContainerRef}
              className={[
                'flex min-h-0 min-w-0 flex-1 bg-base-100',
                selectedDraft.layoutMode === 'vertical' ? 'flex-col' : 'flex-row',
              ].join(' ')}
            >
              {selectedDraft.showCodeEditor ? (
                <>
                  <section
                    className={selectedDraft.showRuntimePreview ? 'min-h-0 min-w-0 overflow-hidden' : 'min-h-0 min-w-0 flex-1 overflow-hidden'}
                    style={
                      selectedDraft.showRuntimePreview
                        ? selectedDraft.layoutMode === 'horizontal'
                        ? { width: `${selectedDraft.splitRatio}%` }
                        : { height: `${selectedDraft.splitRatio}%` }
                        : undefined
                    }
                  >
                    <CodeEditor
                      ref={viewEditorRef}
                      value={selectedDraft.code}
                      externalSelection={
                        pendingSelectionRestoreRef.current?.viewId === selectedDraft.id &&
                        pendingSelectionRestoreRef.current.code === selectedDraft.code
                          ? pendingSelectionRestoreRef.current.selection
                          : null
                      }
                      language="jsx"
                      size="small"
                      showLineNumbers
                      minHeightClassName="min-h-0 h-full"
                      className="h-full border-0"
                      placeholder={DEFAULT_VIEW_SOURCE}
                      extensions={viewRuntimeExtensions}
                      onChange={value => updateDraft(selectedDraft.id, draft => ({ ...draft, code: value }))}
                      onSelectionChange={selection => {
                        viewSelectionRef.current = selection
                      }}
                      onBlur={() => undefined}
                      scale={0.9}
                    />
                  </section>

                  {selectedDraft.showRuntimePreview ? (
                    <button
                      type="button"
                      aria-label="Resize view split"
                      className={[
                        'shrink-0 border-0 bg-base-content/10 transition hover:bg-primary/45',
                        selectedDraft.layoutMode === 'horizontal'
                          ? 'h-full w-[3px] cursor-ew-resize'
                          : 'h-[3px] w-full cursor-ns-resize',
                      ].join(' ')}
                      onMouseDown={event => {
                        resizeStateRef.current = {
                          viewId: selectedDraft.id,
                          layoutMode: selectedDraft.layoutMode,
                          startRatio: selectedDraft.splitRatio,
                          startX: event.clientX,
                          startY: event.clientY,
                        }
                        setIsResizing(true)
                        document.body.style.cursor = selectedDraft.layoutMode === 'horizontal' ? 'ew-resize' : 'ns-resize'
                      }}
                    />
                  ) : null}
                </>
              ) : null}

              {selectedDraft.showRuntimePreview ? (
                <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
                  <ViewRuntimePreview
                    viewId={selectedDraft.id}
                    source={selectedSavedView?.code ?? ''}
                    rememberRequests={selectedSavedView?.rememberRequests ?? false}
                    runRequestId={selectedRunRequestId}
                    environments={runtimeEnvironments}
                    sharedScripts={runtimeSharedScripts}
                    scriptPackages={scriptPackageArtifacts}
                    requestPaths={requestPaths}
                    onRunHandled={requestId => ViewUiHelpers.markRunHandled(requestId)}
                  />
                  {isResizing ? <div className="absolute inset-0 z-10" aria-hidden /> : null}
                </section>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )

  async function createView() {
    const result = await getWindowElectron().createView({
      name: buildNewViewName(items),
      code: DEFAULT_VIEW_SOURCE,
      shortcut: null,
      showCodeEditor: true,
      showRuntimePreview: true,
      layoutMode: 'horizontal',
      splitRatio: 50,
      rememberRequests: false,
    })
    if (!result.success) {
      toast.show(result)
      return
    }

    notifyViewsChanged()
    await reload()
    ViewUiHelpers.selectView(result.data.id)
  }

  function updateDraft(viewId: string, updater: (draft: ViewRecord) => ViewRecord) {
    setEntries(currentEntries => {
      const entry = currentEntries[viewId]
      if (!entry) {
        return currentEntries
      }

      const currentDraft = updater(entry.current)
      return {
        ...currentEntries,
        [viewId]: {
          ...entry,
          current: currentDraft,
          isDirty: serializeViewDraft(currentDraft) !== serializeViewDraft(entry.saved),
        },
      }
    })
  }

  async function saveView(
    viewId: string,
    overrideDraft?: ViewRecord,
    options?: {
      skipFormatting?: boolean
      skipSync?: boolean
    }
  ) {
    const latestEntry = entriesRef.current[viewId]
    const latestDraft = overrideDraft ?? latestEntry?.current
    if (!latestEntry || !latestDraft) {
      return false
    }

    let draftToSave = latestDraft
    if (!options?.skipFormatting && getFormatScriptBlocksOnSave() && latestDraft.code.trim().length > 0) {
      try {
        const selection = viewSelectionRef.current
        const cursorOffset = Math.max(0, Math.min(selection?.head ?? 0, latestDraft.code.length))
        const { formatted, cursorOffset: formattedCursorOffset } = await formatScriptBlockWithCursor(
          latestDraft.code,
          cursorOffset
        )
        const formattedCode = formatted
        if (formattedCode !== latestDraft.code) {
          draftToSave = { ...latestDraft, code: formattedCode }
          pendingSelectionRestoreRef.current = {
            viewId,
            selection: {
              anchor: formattedCursorOffset,
              head: formattedCursorOffset,
            },
            code: formattedCode,
          }
          setEntries(currentEntries => {
            const currentEntry = currentEntries[viewId]
            if (!currentEntry) {
              return currentEntries
            }

            return {
              ...currentEntries,
              [viewId]: {
                ...currentEntry,
                current: draftToSave,
                isDirty: serializeViewDraft(draftToSave) !== serializeViewDraft(currentEntry.saved),
              },
            }
          })
        }
      } catch {
        toast.show({
          severity: 'warning',
          title: 'Script formatting failed',
          message: 'The view was saved without formatting.',
        })
      }
    }

    setEntries(currentEntries => ({
      ...currentEntries,
      [viewId]: {
        ...currentEntries[viewId],
        current: draftToSave,
        saving: true,
      },
    }))

    try {
      const result = await getWindowElectron().updateView({
        id: draftToSave.id,
        name: draftToSave.name,
        code: draftToSave.code,
        shortcut: draftToSave.shortcut,
        showCodeEditor: draftToSave.showCodeEditor,
        showRuntimePreview: draftToSave.showRuntimePreview,
        layoutMode: draftToSave.layoutMode,
        splitRatio: clampSplitRatio(draftToSave.splitRatio),
        rememberRequests: draftToSave.rememberRequests,
      })
      if (!result.success) {
        toast.show(result)
        return false
      }

      const normalizedResult = normalizeViewRecord(result.data)

      setEntries(currentEntries => {
        const currentEntry = currentEntries[viewId]
        if (!currentEntry) {
          return currentEntries
        }

        const nextCurrent =
          serializeViewDraft(currentEntry.current) === serializeViewDraft(normalizedResult)
            ? currentEntry.current
            : normalizedResult

        return {
          ...currentEntries,
          [viewId]: {
            saved: normalizedResult,
            current: nextCurrent,
            isDirty: false,
            saving: false,
          },
        }
      })
      notifyViewsChanged()

      if (!options?.skipSync) {
        void ScriptAiReviewCoordinator.syncEditorCode(
          {
            ownerType: 'view',
            ownerId: normalizedResult.id,
            runtimeContext: { phase: 'view-runtime' },
          },
          normalizedResult.code
        )
      }

      return true
    } finally {
      setEntries(currentEntries => {
        const currentEntry = currentEntries[viewId]
        if (!currentEntry) {
          return currentEntries
        }

        return {
          ...currentEntries,
          [viewId]: {
            ...currentEntry,
            saving: false,
          },
        }
      })
    }
  }

  async function deleteView(viewId: string) {
    const result = await getWindowElectron().deleteView({ id: viewId })
    if (!result.success) {
      toast.show(result)
      return
    }

    setEntries(currentEntries => {
      const nextEntries = { ...currentEntries }
      delete nextEntries[viewId]
      return nextEntries
    })
    notifyViewsChanged()
    await reload()
    const nextSelectedId = items.find(item => item.id !== viewId)?.id ?? null
    ViewUiHelpers.selectView(nextSelectedId)
  }

  function openDocumentation() {
    dialogActions.open({ component: ScriptDocumentationDialog, props: { phase: 'view-runtime' } })
  }
}

function ToolbarButton({
  children,
  label,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const button = (
    <button
      type="button"
      className="inline-flex h-8 items-center justify-center px-0 text-base-content/70 transition disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  )

  return (
    <Tooltip content={label} placement="bottom">
      {button}
    </Tooltip>
  )
}

function CodeEditorVisibilityIcon({ showCodeEditor }: { showCodeEditor: boolean }) {
  return (
    <span className="relative inline-flex size-4 items-center justify-center">
      <FileCode2Icon className="size-4" />
      {showCodeEditor ? null : <span className="absolute h-[1.5px] w-5 rotate-[-45deg] rounded-full bg-current" />}
    </span>
  )
}

function ViewLayoutChooser({
  value,
  onChange,
}: {
  value: ViewLayoutChoice
  onChange: (value: ViewLayoutChoice) => void
}) {
  const options: ReadonlyArray<{ value: ViewLayoutChoice; label: string; icon: ReactNode }> = [
    { value: 'stacked', label: 'Stacked layout', icon: <Rows3Icon className="size-4" /> },
    { value: 'side-by-side', label: 'Side-by-side layout', icon: <Columns2Icon className="size-4" /> },
    { value: 'only-code', label: 'Only code', icon: <CodeEditorVisibilityIcon showCodeEditor /> },
    { value: 'only-view', label: 'Only view', icon: <PreviewVisibilityIcon showRuntimePreview /> },
  ]

  const selectedOption = options.find(option => option.value === value)
  if (!selectedOption) {
    return null
  }

  return (
    <div className="group relative flex items-center justify-center" tabIndex={0}>
      <button
        type="button"
        className="inline-flex h-8 items-center justify-center px-0 text-base-content/70 transition cursor-pointer"
        aria-label={selectedOption.label}
      >
        {selectedOption.icon}
      </button>

      <div className="pointer-events-none absolute right-0 top-full z-20 w-52 pt-2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <div className="rounded-2xl border border-base-content/10 bg-base-100 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          {options.map(option => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                className={[
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                  isSelected
                    ? 'bg-primary/10 text-base-content'
                    : 'text-base-content/72 hover:bg-base-200/70 hover:text-base-content',
                ].join(' ')}
                onClick={() => onChange(option.value)}
              >
                <span className="inline-flex size-4 items-center justify-center">{option.icon}</span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PreviewVisibilityIcon({ showRuntimePreview }: { showRuntimePreview: boolean }) {
  return (
    <span className="relative inline-flex size-4 items-center justify-center">
      <PlayIcon className="size-4" />
      {showRuntimePreview ? null : <span className="absolute h-[1.5px] w-5 rotate-[-45deg] rounded-full bg-current" />}
    </span>
  )
}

function ViewShortcutEditor({
  shortcut,
  onChange,
}: {
  shortcut: ViewShortcut | null
  onChange: (shortcut: ViewShortcut | null) => void
}) {
  return (
    <div className="relative flex items-center justify-center">
      <ToolbarButton
        label="Change shortcut"
        onClick={() => dialogActions.open({ component: ViewShortcutDialog, props: { shortcut, onChange } })}
      >
        <KeyboardIcon className="size-4" />
      </ToolbarButton>

      {shortcut ? (
        <ShortcutDisplay
          shortcut={shortcut}
          className="pointer-events-none absolute -bottom-2 left-1/2 min-h-0 -translate-x-1/2 border-base-content/10 bg-base-100 px-1 py-0 text-[8px] leading-3 text-base-content/70 shadow-sm dark:border-base-content/10 dark:bg-base-100 dark:text-base-content/70"
        />
      ) : null}
    </div>
  )
}

function ViewShortcutDialog({
  shortcut,
  onChange,
}: {
  shortcut: ViewShortcut | null
  onChange: (shortcut: ViewShortcut | null) => void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const { recordedShortcut, resetRecordedShortcut } = useShortcutRecorder(isRecording)

  return (
    <Dialog
      title="View Shortcut"
      onClose={dialogActions.close}
      className="max-w-[420px]"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              resetRecordedShortcut()
              setIsRecording(false)
              dialogActions.close()
            }}
          >
            Cancel
          </button>
          {shortcut ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                onChange(null)
                resetRecordedShortcut()
                setIsRecording(false)
                dialogActions.close()
              }}
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!recordedShortcut}
            onClick={() => {
              if (!recordedShortcut) {
                return
              }

              onChange(recordedShortcut)
              resetRecordedShortcut()
              setIsRecording(false)
              dialogActions.close()
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex items-center justify-center px-1 py-2">
        <div className="flex items-center gap-2">
          <ShortcutDisplay
            shortcut={isRecording ? recordedShortcut : shortcut}
            placeholder={isRecording ? 'Press a key combination' : 'No shortcut'}
            className="flex h-9 min-w-[180px] items-center justify-center text-center"
          />
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-base-200/60 text-base-content/70 transition hover:bg-base-200"
            onClick={() => {
              resetRecordedShortcut()
              setIsRecording(true)
            }}
            aria-label="Edit shortcut"
          >
            <Edit2Icon className="size-4" />
          </button>
        </div>
      </div>
    </Dialog>
  )
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">{message}</div>
  )
}

function buildNewViewName(items: ViewRecord[]) {
  const existingNames = new Set(items.map(item => item.name))
  let index = 1
  while (existingNames.has(`View ${index}`)) {
    index += 1
  }

  return `View ${index}`
}

function serializeViewDraft(view: ViewRecord) {
  const normalizedView = normalizeViewRecord(view)
  return JSON.stringify({
    name: normalizedView.name,
    code: normalizedView.code,
    shortcut: normalizedView.shortcut,
    showCodeEditor: normalizedView.showCodeEditor,
    showRuntimePreview: normalizedView.showRuntimePreview,
    layoutMode: normalizedView.layoutMode,
    splitRatio: clampSplitRatio(normalizedView.splitRatio),
    rememberRequests: normalizedView.rememberRequests,
  })
}

function getViewLayoutChoice(view: Pick<ViewRecord, 'showCodeEditor' | 'showRuntimePreview' | 'layoutMode'>): ViewLayoutChoice {
  const normalizedVisibility = normalizeViewVisibility(view)
  if (normalizedVisibility.showCodeEditor && normalizedVisibility.showRuntimePreview) {
    return view.layoutMode === 'vertical' ? 'stacked' : 'side-by-side'
  }

  if (normalizedVisibility.showCodeEditor) {
    return 'only-code'
  }

  if (normalizedVisibility.showRuntimePreview) {
    return 'only-view'
  }

  return 'side-by-side'
}

function normalizeViewRecord(view: ViewRecord): ViewRecord {
  return {
    ...view,
    ...normalizeViewVisibility(view),
  }
}

function normalizeViewVisibility(
  view: Pick<ViewRecord, 'showCodeEditor' | 'showRuntimePreview'>
): Pick<ViewRecord, 'showCodeEditor' | 'showRuntimePreview'> {
  return {
    showCodeEditor: view.showCodeEditor ?? true,
    showRuntimePreview: view.showRuntimePreview ?? true,
  }
}

function applyViewLayoutChoice(view: ViewRecord, choice: ViewLayoutChoice): ViewRecord {
  switch (choice) {
    case 'stacked':
      return {
        ...view,
        showCodeEditor: true,
        showRuntimePreview: true,
        layoutMode: 'vertical',
      }
    case 'side-by-side':
      return {
        ...view,
        showCodeEditor: true,
        showRuntimePreview: true,
        layoutMode: 'horizontal',
      }
    case 'only-code':
      return {
        ...view,
        showCodeEditor: true,
        showRuntimePreview: false,
      }
    case 'only-view':
      return {
        ...view,
        showCodeEditor: false,
        showRuntimePreview: true,
      }
    default:
      return Typescript.assertUnreachable(choice)
  }
}

function getViewLayoutChoiceLabel(choice: ViewLayoutChoice) {
  switch (choice) {
    case 'stacked':
      return 'Stacked'
    case 'side-by-side':
      return 'Side by side'
    case 'only-code':
      return 'Only code'
    case 'only-view':
      return 'Only view'
    default:
      return Typescript.assertUnreachable(choice)
  }
}

function parseEnvironmentValues(value: string) {
  return Object.fromEntries(
    parseKeyValueRows(value)
      .filter(row => row.enabled && row.key.trim())
      .map(row => [row.key, row.value])
  )
}

function clampSplitRatio(value: number) {
  return Math.max(MIN_VIEW_SPLIT_RATIO, Math.min(MAX_VIEW_SPLIT_RATIO, Math.round(value)))
}

function buildViewRequestPaths(items: ExplorerItem[]) {
  const itemMap = new Map(items.map(item => [item.id, item]))
  type HttpExplorerRequestItem = ExplorerRequestItem & { requestType: 'http' }

  return items
    .filter((item): item is HttpExplorerRequestItem => item.itemType === 'request' && item.requestType === 'http')
    .map(item => ({
      requestId: item.id,
      path: [...getFolderPathSegments(itemMap, item.parentFolderId ?? null), item.name],
    }))
}

function getFolderPathSegments(
  itemMap: Map<string, { itemType: string; name?: string; parentFolderId?: string | null }>,
  parentFolderId: string | null
) {
  const segments: string[] = []
  let currentFolderId = parentFolderId

  while (currentFolderId) {
    const folder = itemMap.get(currentFolderId)
    if (!folder || folder.itemType !== 'folder' || typeof folder.name !== 'string') {
      break
    }

    segments.unshift(folder.name)
    currentFolderId = folder.parentFolderId ?? null
  }

  return segments
}

const DEFAULT_VIEW_SOURCE = `export default function View() {
  const [result, setResult] = useState<unknown | null>(null)

  async function load() {
    const response = await callRequest(['Folder', 'Request Name'])
    setResult(response.body.data)
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 12 }}>
      <button onClick={load}>Run flow</button>
      {result === null ? null : <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  )
}`
