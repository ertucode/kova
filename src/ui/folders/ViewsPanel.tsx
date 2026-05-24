import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import { Columns2Icon, InfoIcon, PlayIcon, PlusIcon, Rows3Icon, SaveIcon, Trash2Icon } from 'lucide-react'
import type { ExplorerItem, ExplorerRequestItem } from '@common/Explorer'
import { parseKeyValueRows } from '@common/KeyValueRows'
import type { ViewLayoutMode, ViewRecord } from '@common/Views'
import { getWindowElectron } from '@/getWindowElectron'
import { dialogActions } from '@/global/dialogStore'
import { toast } from '@/lib/components/toast'
import { Tooltip } from '../components/Tooltip'
import { CodeEditor } from './CodeEditor'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { scriptDiagnosticsExtension } from './codeEditorScriptDiagnostics'
import { environmentEditorStore } from './environmentEditorStore'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { buildHttpRequestPaths } from './folderExplorerUtils'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { useScriptPackageArtifacts } from './useScriptPackages'
import { useViews, notifyViewsChanged } from './useViews'
import { useVisibleSharedScripts } from './useVisibleSharedScripts'
import { ViewRuntimePreview } from './ViewRuntimePreview'

type ViewEditorEntry = {
  saved: ViewRecord
  current: ViewRecord
  isDirty: boolean
  saving: boolean
}

const PERSISTED_SELECTED_VIEW_ID_KEY = 'views:selectedId'
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
  const [selectedId, setSelectedId] = useState<string | null>(() => loadSelectedViewId())
  const [entries, setEntries] = useState<Record<string, ViewEditorEntry>>({})
  const [runTriggerVersion, setRunTriggerVersion] = useState(0)
  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{
    viewId: string
    layoutMode: ViewLayoutMode
    startRatio: number
    startX: number
    startY: number
  } | null>(null)

  const sharedScriptsRef = useRef(visibleSharedScripts)
  const scriptPackageArtifactsRef = useRef(scriptPackageArtifacts)
  const environmentNamesRef = useRef<string[]>([])
  const variableNamesRef = useRef<string[]>([])
  const entriesRef = useRef<Record<string, ViewEditorEntry>>({})

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

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
        const currentEntry = currentEntries[item.id]
        if (currentEntry?.isDirty) {
          nextEntries[item.id] = {
            ...currentEntry,
            saved: item,
            isDirty: serializeViewDraft(currentEntry.current) !== serializeViewDraft(item),
          }
          continue
        }

        nextEntries[item.id] = {
          saved: item,
          current: item,
          isDirty: false,
          saving: currentEntry?.saving ?? false,
        }
      }

      return nextEntries
    })
  }, [items])

  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null)
      }
      return
    }

    if (!selectedId || !items.some(item => item.id === selectedId)) {
      setSelectedId(items[0]?.id ?? null)
    }
  }, [items, selectedId])

  useEffect(() => {
    persistSelectedViewId(selectedId)
  }, [selectedId])

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
        setRunTriggerVersion(version => version + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [selectedId])

  const selectedEntry = selectedId ? entries[selectedId] ?? null : null
  const selectedDraft = selectedEntry?.current ?? null
  const selectedSavedView = selectedEntry?.saved ?? null
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
              <div className="mt-1 text-sm text-base-content/45">Saved React views for multi-request flows.</div>
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
                  onClick={() => setSelectedId(item.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{entry?.current.name || item.name}</div>
                    <div className="mt-1 text-xs text-base-content/45">
                      {entry?.current.layoutMode === 'vertical' ? 'Stacked' : 'Side by side'}
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
            <header className="flex items-center gap-3 border-b border-base-content/10 px-4 py-3">
              <input
                value={selectedDraft.name}
                onChange={event => updateDraft(selectedDraft.id, draft => ({ ...draft, name: event.target.value }))}
                placeholder="View name"
                className="min-w-0 flex-1 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content outline-none transition focus:border-base-content/25"
              />

              <label className="flex items-center gap-2 text-sm text-base-content/65">
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
                Remember Requests
              </label>

              <ToolbarButton
                label={selectedDraft.layoutMode === 'horizontal' ? 'Stacked layout' : 'Side-by-side layout'}
                onClick={() => {
                  const nextDraft: ViewRecord = {
                    ...selectedDraft,
                    layoutMode: selectedDraft.layoutMode === 'horizontal' ? 'vertical' : 'horizontal',
                  }
                  updateDraft(selectedDraft.id, () => nextDraft)
                  void saveView(selectedDraft.id, nextDraft)
                }}
              >
                {selectedDraft.layoutMode === 'horizontal' ? <Rows3Icon className="size-4" /> : <Columns2Icon className="size-4" />}
              </ToolbarButton>

              <ToolbarButton label="Documentation" onClick={() => openDocumentation()}>
                <InfoIcon className="size-4" />
              </ToolbarButton>

              <ToolbarButton label="Save" onClick={() => void saveView(selectedDraft.id)} disabled={!selectedEntry?.isDirty || selectedEntry.saving}>
                <SaveIcon className="size-4" />
              </ToolbarButton>

              <ToolbarButton label="Run runner" onClick={() => setRunTriggerVersion(version => version + 1)}>
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
              <section
                className="min-h-0 min-w-0 overflow-hidden"
                style={
                  selectedDraft.layoutMode === 'horizontal'
                    ? { width: `${selectedDraft.splitRatio}%` }
                    : { height: `${selectedDraft.splitRatio}%` }
                }
              >
                <CodeEditor
                  value={selectedDraft.code}
                  language="jsx"
                  size="small"
                  showLineNumbers
                  minHeightClassName="min-h-0 h-full"
                  className="h-full border-0"
                  placeholder={DEFAULT_VIEW_SOURCE}
                  extensions={viewRuntimeExtensions}
                  onChange={value => updateDraft(selectedDraft.id, draft => ({ ...draft, code: value }))}
                  onBlur={() => undefined}
                />
              </section>

              <button
                type="button"
                aria-label="Resize view split"
                className={[
                  'shrink-0 border-0 bg-base-content/10 transition hover:bg-primary/45',
                  selectedDraft.layoutMode === 'horizontal' ? 'h-full w-[3px] cursor-ew-resize' : 'h-[3px] w-full cursor-ns-resize',
                ].join(' ')}
                onMouseDown={event => {
                  resizeStateRef.current = {
                    viewId: selectedDraft.id,
                    layoutMode: selectedDraft.layoutMode,
                    startRatio: selectedDraft.splitRatio,
                    startX: event.clientX,
                    startY: event.clientY,
                  }
                  document.body.style.cursor = selectedDraft.layoutMode === 'horizontal' ? 'ew-resize' : 'ns-resize'
                }}
              />

              <section className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <ViewRuntimePreview
                  viewId={selectedDraft.id}
                  source={selectedSavedView?.code ?? ''}
                  rememberRequests={selectedSavedView?.rememberRequests ?? false}
                  runTriggerVersion={runTriggerVersion}
                  environments={runtimeEnvironments}
                  sharedScripts={runtimeSharedScripts}
                  scriptPackages={scriptPackageArtifacts}
                  requestPaths={requestPaths}
                />
              </section>
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
    setSelectedId(result.data.id)
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

  async function saveView(viewId: string, overrideDraft?: ViewRecord) {
    const latestEntry = entriesRef.current[viewId]
    const latestDraft = overrideDraft ?? latestEntry?.current
    if (!latestEntry || !latestDraft) {
      return
    }

    setEntries(currentEntries => ({
      ...currentEntries,
      [viewId]: {
        ...currentEntries[viewId],
        saving: true,
      },
    }))

    try {
      const result = await getWindowElectron().updateView({
        id: latestDraft.id,
        name: latestDraft.name,
        code: latestDraft.code,
        layoutMode: latestDraft.layoutMode,
        splitRatio: clampSplitRatio(latestDraft.splitRatio),
        rememberRequests: latestDraft.rememberRequests,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      setEntries(currentEntries => ({
        ...currentEntries,
        [viewId]: {
          saved: result.data,
          current: result.data,
          isDirty: false,
          saving: false,
        },
      }))
      notifyViewsChanged()
      await reload()
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
    setSelectedId(nextSelectedId)
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
      className="inline-flex h-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 px-3 text-base-content/70 transition hover:border-base-content/20 hover:bg-base-200/70 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40"
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

function PanelEmptyState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">{message}</div>
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
  return JSON.stringify({
    name: view.name,
    code: view.code,
    layoutMode: view.layoutMode,
    splitRatio: clampSplitRatio(view.splitRatio),
    rememberRequests: view.rememberRequests,
  })
}

function parseEnvironmentValues(value: string) {
  return Object.fromEntries(
    parseKeyValueRows(value)
      .filter(row => row.enabled && row.key.trim())
      .map(row => [row.key, row.value])
  )
}

function loadSelectedViewId() {
  try {
    return localStorage.getItem(PERSISTED_SELECTED_VIEW_ID_KEY)
  } catch {
    return null
  }
}

function persistSelectedViewId(value: string | null) {
  try {
    if (value) {
      localStorage.setItem(PERSISTED_SELECTED_VIEW_ID_KEY, value)
      return
    }

    localStorage.removeItem(PERSISTED_SELECTED_VIEW_ID_KEY)
  } catch {
    return
  }
}

function clampSplitRatio(value: number) {
  return Math.max(MIN_VIEW_SPLIT_RATIO, Math.min(MAX_VIEW_SPLIT_RATIO, Math.round(value)))
}

function buildViewRequestPaths(items: ExplorerItem[]) {
  const itemMap = new Map(items.map(item => [item.id, item]))
  type HttpExplorerRequestItem = ExplorerRequestItem & { requestType: 'http' }

  return items
    .filter(
      (item): item is HttpExplorerRequestItem =>
        item.itemType === 'request' && item.requestType === 'http'
    )
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
