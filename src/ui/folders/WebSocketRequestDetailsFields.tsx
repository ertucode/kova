import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSelector } from '@xstate/store/react'
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, InfoIcon, PlugIcon, SearchIcon, SendIcon, Trash2Icon, WifiOffIcon } from 'lucide-react'
import { resolveEnvironmentVariables } from '@common/EnvironmentVariables'
import { buildEnvironmentVariableMap } from '@common/RequestVariables'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { syncSearchParamsWithUrl, syncUrlWithSearchParams } from '@common/PathParams'
import type { WebSocketMessageRecord, WebSocketSavedMessageRecord } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { AuthorizationEditor } from './AuthorizationEditor'
import { CodeEditor } from './CodeEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { KeyValueEditor } from './KeyValueEditor'
import { HeadersEditor } from './HeadersEditor'
import { folderExplorerEditorStore, saveFolderExplorerUiState } from './folderExplorerEditorStore'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { requestExecutionStore } from './requestExecutionStore'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { searchParamHighlightExtension } from './codeEditorSearchParamHighlight'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { buildImportedWebSocketUrlFields } from './requestUrlImport'

type WebSocketMetaTab = 'overview' | 'search-params'
type MessageFilter = 'all' | 'sent' | 'received'

export function WebSocketRequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [metaTab, setMetaTab] = useState<WebSocketMetaTab>('overview')
  const [messageSearch, setMessageSearch] = useState('')
  const [messageFilter, setMessageFilter] = useState<MessageFilter>('all')
  const [savedMessages, setSavedMessages] = useState<WebSocketSavedMessageRecord[]>([])
  const [savedMessagesLoaded, setSavedMessagesLoaded] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [isResizingResponsePane, setIsResizingResponsePane] = useState(false)
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const responsePaneHeight = useSelector(folderExplorerEditorStore, state => state.context.responsePaneHeight)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const session = useSelector(requestExecutionStore, state =>
    selectedRequestId ? (state.context.websocketSessionByRequestId[selectedRequestId] ?? null) : null
  )

  const activeEnvironmentVariableNames = useMemo(() => {
    const activeEnvironments = environments
      .filter(environment => activeEnvironmentIds.includes(environment.id))
      .map(environment => {
        const nextDraft = environmentEntries[environment.id]?.current

        return {
          ...environment,
          name: nextDraft?.name ?? environment.name,
          variables: nextDraft?.variables ?? environment.variables,
          priority: nextDraft?.priority ?? environment.priority,
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
          valueByVariableName: new Map(Array.from(resolveEnvironmentVariables({ variables }).entries()).map(([key, row]) => [key, row.value])),
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

  activeEnvironmentVariableNamesRef.current = activeEnvironmentVariableNames
  variableTooltipRowsRef.current = variableTooltipRows
  variableAutocompleteItemsRef.current = variableAutocompleteItems

  const variableEditorExtensions = useMemo(
    () => [
      variableHighlightExtension({
        getDefinedVariableNames: () => activeEnvironmentVariableNamesRef.current,
        getEnvironments: () => variableTooltipRowsRef.current,
        onToggleEnvironment: environmentId => EnvironmentCoordinator.toggleActiveEnvironment(environmentId),
        onOpenEnvironment: environmentId => EnvironmentCoordinator.openEnvironmentDetails(environmentId),
        onChangeValue: (environmentId, variableName, value) => updateEnvironmentVariableDraft(environmentId, variableName, value),
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
        onChangeValue: (environmentId, variableName, value) => updateEnvironmentVariableDraft(environmentId, variableName, value),
        onSaveValue: environmentId => EnvironmentCoordinator.saveEnvironment(environmentId),
      }),
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current, { fallbackToBrowserTab: true }),
    ],
    []
  )

  const urlEditorExtensions = useMemo(() => [searchParamHighlightExtension(), ...variableEditorExtensions], [variableEditorExtensions])

  useEffect(() => {
    setMetaTab('overview')
    setMessageSearch('')
    setMessageFilter('all')
  }, [selectedRequestId])

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
  }, [responsePaneHeight])

  useEffect(() => {
    if (!selectedRequestId) {
      setSavedMessages([])
      setSavedMessagesLoaded(false)
      return
    }

    void loadSavedMessages(selectedRequestId)
  }, [selectedRequestId])

  const visibleMessages = useMemo(() => {
    const normalizedQuery = messageSearch.trim().toLowerCase()
    return (session?.messages ?? []).filter(message => {
      if (messageFilter !== 'all' && message.direction !== messageFilter) {
        return false
      }
      if (!normalizedQuery) {
        return true
      }
      return message.body.toLowerCase().includes(normalizedQuery)
    })
  }, [messageFilter, messageSearch, session?.messages])

  async function loadSavedMessages(requestId: string) {
    try {
      const items = await getWindowElectron().listWebSocketSavedMessages({ requestId })
      setSavedMessages(items)
      setSavedMessagesLoaded(true)
    } catch {
      setSavedMessages([])
      setSavedMessagesLoaded(true)
    }
  }

  async function handleConnect() {
    if (!selectedRequestId) {
      return
    }

    setIsConnecting(true)
    const result = await getWindowElectron().connectWebSocket({
      requestId: selectedRequestId,
      url: draft.url,
      searchParams: draft.searchParams,
      auth: draft.auth,
      preRequestScript: draft.preRequestScript,
      postRequestScript: draft.postRequestScript,
      headers: draft.headers,
      websocketSubprotocols: draft.websocketSubprotocols,
      activeEnvironmentIds,
      saveToHistory: draft.saveToHistory,
      historyKeepLast: requestExecutionStore.getSnapshot().context.historyKeepLast,
    })
    setIsConnecting(false)

    if (!result.success) {
      toast.show(result)
      return
    }

    requestExecutionStore.trigger.websocketSessionUpdated({ session: result.data.session })
  }

  async function handleDisconnect() {
    if (!selectedRequestId) {
      return
    }

    const result = await getWindowElectron().disconnectWebSocket({ requestId: selectedRequestId })
    if (!result.success) {
      toast.show(result)
    }
  }

  async function handleSendMessage(body: string) {
    if (!selectedRequestId || !body.trim()) {
      return
    }

    setIsSendingMessage(true)
    const result = await getWindowElectron().sendWebSocketMessage({
      requestId: selectedRequestId,
      body,
      activeEnvironmentIds,
    })
    setIsSendingMessage(false)
    if (!result.success) {
      toast.show(result)
      return
    }

    FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body })
  }

  async function handleSaveCurrentMessage() {
    if (!selectedRequestId || !draft.body.trim()) {
      return
    }

    const result = await getWindowElectron().createWebSocketSavedMessage({
      requestId: selectedRequestId,
      body: draft.body,
    })
    if (!result.success) {
      toast.show(result)
      return
    }

    setSavedMessages(current => [...current, result.data])
    toast.show({ severity: 'success', title: 'Message saved', message: 'Saved this WebSocket message for reuse.' })
  }

  async function handleDeleteSavedMessage(id: string) {
    const result = await getWindowElectron().deleteWebSocketSavedMessage({ id })
    if (!result.success) {
      toast.show(result)
      return
    }

    setSavedMessages(current => current.filter(item => item.id !== id))
  }

  function clearMessages() {
    if (!session) {
      return
    }

    requestExecutionStore.trigger.websocketSessionUpdated({
      session: {
        ...session,
        historySizeBytes: 0,
        messages: [],
      },
    })
  }

  async function handleSaveAsExample() {
    if (!selectedRequestId || !session) {
      return
    }

    const result = await getWindowElectron().createWebSocketExample({
      requestId: selectedRequestId,
      name: `${draft.name} ${formatTimestamp(session.connectedAt)}`,
      requestHeaders: draft.headers,
      requestBody: draft.body,
      messages: session.messages.map(message => ({
        direction: message.direction,
        body: message.body,
        mimeType: message.mimeType,
        sizeBytes: message.sizeBytes,
        timestamp: message.timestamp,
      })),
    })

    if (!result.success) {
      toast.show(result)
      return
    }

    await FolderExplorerCoordinator.loadItems()
    await FolderExplorerCoordinator.selectItem({ itemType: 'example', id: result.data.id })
    toast.show({ severity: 'success', title: 'Example saved', message: `Saved transcript example for ${draft.name}.` })
  }

  function startResize(event: ReactPointerEvent<HTMLButtonElement>) {
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: responsePaneHeight,
    }
    setIsResizingResponsePane(true)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  const importUrl = (nextUrl: string) => {
    const importedUrlFields = buildImportedWebSocketUrlFields(nextUrl)
    const { metaTab: nextMetaTab, ...nextUrlFields } = importedUrlFields

    FolderExplorerCoordinator.updateSelectedDraft({
      ...draft,
      ...nextUrlFields,
    })

    setMetaTab(nextMetaTab)

    toast.show({
      severity: 'success',
      title: 'Imported URL',
      message: 'Rebuilt request URL fields from pasted URL.',
    })
  }

  const handleUrlPaste = (value: string) => {
    const nextUrl = value.trim()
    if (!nextUrl || nextUrl.includes('\n')) {
      return false
    }

    try {
      const parsedUrl = new URL(nextUrl)
      if (parsedUrl.protocol !== 'ws:' && parsedUrl.protocol !== 'wss:') {
        return false
      }
    } catch {
      return false
    }

    importUrl(nextUrl)
    return true
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="w-full border-b border-base-content/10">
        <div className="flex w-full items-center overflow-visible border border-base-content/10 bg-base-100/70">
          <div className="flex min-w-0 flex-1 overflow-hidden">
            <CodeEditor
              value={draft.url}
              language="plain"
              singleLine
              className="min-w-0 flex-1 border-0"
              placeholder="wss://echo.websocket.events"
              extensions={urlEditorExtensions}
              refreshKey={variableHighlightRefreshKey}
              onPasteText={handleUrlPaste}
              onChange={value =>
                FolderExplorerCoordinator.updateSelectedDraft({
                  ...draft,
                  url: value,
                  searchParams: syncSearchParamsWithUrl(value, draft.searchParams),
                })
              }
            />

            {session?.connectionState === 'open' ? (
              <button
                type="button"
                className="shrink-0 border-0 border-l border-base-content/10 bg-base-200 px-5 py-4 text-sm font-medium text-base-content transition hover:bg-base-300"
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                className="shrink-0 border-0 border-l border-base-content/10 bg-base-200 px-5 py-4 text-sm font-medium text-base-content transition hover:bg-base-300"
                onClick={() => void handleConnect()}
                disabled={isConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-10 items-center border-b border-base-content/10 text-xs text-base-content/50">
          <button
            type="button"
            className={getTabClassName(metaTab === 'overview')}
            onClick={() => setMetaTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={getTabClassName(metaTab === 'search-params')}
            onClick={() => setMetaTab('search-params')}
          >
            Search Params
          </button>
        </div>
      </section>

      {metaTab === 'overview' ? (
        <section className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="flex min-h-0 flex-col border-r border-base-content/10">
            <DetailsSectionHeader
              title="Message"
              actions={
                <>
                  <button
                    type="button"
                    className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase tracking-[0.08em] text-base-content transition hover:bg-base-200/70"
                    onClick={() => void handleSendMessage(draft.body)}
                    disabled={session?.connectionState !== 'open' || isSendingMessage}
                  >
                    {isSendingMessage ? 'Sending...' : 'Send Message'}
                  </button>
                  <button
                    type="button"
                    className="h-full rounded-none border-l border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase tracking-[0.08em] text-base-content transition hover:bg-base-200/70"
                    onClick={() => void handleSaveCurrentMessage()}
                    disabled={!draft.body.trim()}
                  >
                    Save Message
                  </button>
                </>
              }
            />
            <CodeEditor
              value={draft.body}
              language="plain"
              size="small"
              minHeightClassName="min-h-[220px]"
              className="border-x-0 border-b border-base-content/10"
              placeholder="Type a message to send after connecting"
              extensions={variableEditorExtensions}
              refreshKey={variableHighlightRefreshKey}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: value })}
            />

            <div className="min-h-0 flex-1 overflow-auto">
              <DetailsSectionHeader title="Saved Messages" />
              {savedMessagesLoaded && savedMessages.length === 0 ? (
                <div className="px-3 py-4 text-sm text-base-content/45">No saved messages yet.</div>
              ) : (
                <div className="space-y-2 p-3">
                  {savedMessages.map(message => (
                    <div key={message.id} className="rounded-2xl border border-base-content/10 bg-base-100/55 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-base-content/45">
                        <span>{formatTimestamp(message.updatedAt)}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
                            onClick={() => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, body: message.body })}
                            title="Load into composer"
                          >
                            <CopyIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
                            onClick={() => void handleSendMessage(message.body)}
                            disabled={session?.connectionState !== 'open'}
                            title="Send saved message"
                          >
                            <SendIcon className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-base-content/45 transition hover:bg-error/10 hover:text-error"
                            onClick={() => void handleDeleteSavedMessage(message.id)}
                            title="Delete saved message"
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-base-content">
                        {message.body}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-y-auto">
            <div className="border-b border-base-content/10">
              <DetailsSectionHeader title="Subprotocols" />
              <div className="p-3">
                <CodeEditor
                  value={draft.websocketSubprotocols}
                  language="plain"
                  singleLine
                  compact
                  className="h-11 rounded-2xl [&_.cm-content]:!pl-3 [&_.cm-content]:!pr-3"
                  placeholder="graphql-ws, {{protocolName}}"
                  extensions={variableEditorExtensions}
                  refreshKey={variableHighlightRefreshKey}
                  onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, websocketSubprotocols: value })}
                />
              </div>
            </div>

            <AuthorizationEditor
              value={draft.auth}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, auth: value })}
              allowInherit
              valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
              valueEditorRefreshKey={variableHighlightRefreshKey}
            />

            <HeadersEditor
              value={draft.headers}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
              valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
              valueEditorRefreshKey={variableHighlightRefreshKey}
            />
          </div>
        </section>
      ) : null}

      {metaTab === 'search-params' ? (
        <section className="min-h-0 flex-1 overflow-auto">
          <KeyValueEditor
            label={null}
            value={draft.searchParams}
            onChange={value =>
              FolderExplorerCoordinator.updateSelectedDraft({
                ...draft,
                searchParams: value,
                url: syncUrlWithSearchParams(draft.url, value),
              })
            }
            keyPlaceholder="token"
            valuePlaceholder="123"
            valueEditorAsCode
            valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
            valueEditorRefreshKey={variableHighlightRefreshKey}
            contentClassName="border-t-0"
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

        <div className="h-[calc(100%-2px)] overflow-auto">
          <DetailsSectionHeader
            title={
              <div className="flex items-center gap-3">
                <span>Response</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-base-content/45">
                  {session?.connectionState === 'open' ? <PlugIcon className="size-3.5 text-success" /> : <WifiOffIcon className="size-3.5" />}
                  {session ? toConnectionLabel(session.connectionState) : 'Disconnected'}
                </span>
              </div>
            }
            actions={
              <div className="flex items-center gap-2 px-3">
                <label className="flex h-9 items-center gap-2 rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-xs font-medium text-base-content/60">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={draft.saveToHistory}
                    onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, saveToHistory: event.target.checked })}
                  />
                  <span>Save to history</span>
                </label>
                <label className="flex h-9 items-center gap-2 rounded-xl border border-base-content/10 bg-base-100/70 px-3 text-sm text-base-content/60">
                  <SearchIcon className="size-4" />
                  <input
                    type="text"
                    className="w-52 bg-transparent outline-none placeholder:text-base-content/35"
                    placeholder="Search messages"
                    value={messageSearch}
                    onChange={event => setMessageSearch(event.target.value)}
                  />
                </label>
                <DropdownSelect
                  value={messageFilter}
                  className="w-[190px]"
                  triggerClassName="h-9 bg-base-100/70 px-3 text-xs font-medium uppercase"
                  menuClassName="w-[190px]"
                  options={[
                    { value: 'all', label: <span>All Messages</span> },
                    { value: 'sent', label: <span>Sent Messages</span> },
                    { value: 'received', label: <span>Received Messages</span> },
                  ]}
                  onChange={value => setMessageFilter(value as MessageFilter)}
                />
                <button
                  type="button"
                  className="rounded-xl border border-base-content/10 bg-base-100/70 px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
                  onClick={() => void handleSaveAsExample()}
                  disabled={!session || session.messages.length === 0}
                >
                  Save as Example
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-base-content/10 bg-base-100/70 px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] text-base-content/65 transition hover:border-base-content/20 hover:text-base-content"
                  onClick={clearMessages}
                >
                  Clear Messages
                </button>
              </div>
            }
          />

          <div className="px-3 py-3">
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-base-content/45">
              {session ? <span>{formatBytes(session.historySizeBytes)}</span> : null}
              {session?.responseError ? <span className="text-error">{session.responseError}</span> : null}
            </div>

            {visibleMessages.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-6 text-sm text-base-content/45">
                {session ? 'No messages match your filters.' : 'Connect to start receiving messages.'}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleMessages.map((message: WebSocketMessageRecord) => (
                  <TranscriptRow key={message.id} message={message} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function TranscriptRow({
  message,
}: {
  message: WebSocketMessageRecord
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-2xl border border-base-content/10 bg-base-100/55">
      <div className="flex min-w-0 items-start gap-2 px-3 py-2.5">
        <button
          type="button"
          className="mt-0.5 shrink-0 text-base-content/45 transition hover:text-base-content/70"
          onClick={() => setExpanded(current => !current)}
        >
          {expanded ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/45">
            <span className={message.direction === 'sent' ? 'text-info' : 'text-success'}>{message.direction}</span>
            <span>{formatTimestamp(message.timestamp)}</span>
            <span>{formatBytes(message.sizeBytes)}</span>
            {message.mimeType ? <span>{message.mimeType}</span> : null}
          </div>
          {expanded ? (
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-5 text-base-content">
              {message.body || '(empty)'}
            </pre>
          ) : (
            <div className="mt-1 truncate font-mono text-xs text-base-content/75">
              {getCollapsedMessagePreview(message.body)}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
            onClick={() => void navigator.clipboard.writeText(message.body)}
            title="Copy message"
          >
            <CopyIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
            title={`Size: ${formatBytes(message.sizeBytes)}${message.mimeType ? ` | MIME: ${message.mimeType}` : ''}`}
          >
            <InfoIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function getTabClassName(isActive: boolean) {
  return [
    'h-10 border-r border-base-content/10 px-3 text-xs font-semibold transition',
    isActive ? 'border-b-2 border-b-base-content text-base-content' : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
  ].join(' ')
}

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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

function clampResponsePaneHeight(height: number) {
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  return Math.max(180, Math.min(height, Math.floor(viewportHeight * 0.8)))
}

function getCollapsedMessagePreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return '(empty)'
  }

  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
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

function toConnectionLabel(value: 'connecting' | 'open' | 'closed') {
  if (value === 'open') {
    return 'Connected'
  }

  if (value === 'connecting') {
    return 'Connecting'
  }

  return 'Disconnected'
}
