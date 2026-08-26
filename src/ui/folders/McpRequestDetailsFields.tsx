import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSelector } from '@xstate/store/react'
import type { RequestMetaTab } from '@common/FolderExplorerTabs'
import { errorResponseToMessage } from '@common/GenericError'
import {
  REQUEST_TLS_VERIFICATION_MODES,
  type McpPromptSummary,
  type McpResourceSummary,
  type McpToolSummary,
} from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { SettingsDropdownFieldRow, SettingsTab } from '@/components/settings'
import { buildTlsVerificationModeDropdownOptions } from '@/components/tlsVerificationMode'
import { toast } from '@/lib/components/toast'
import { CodeEditor } from './CodeEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { environmentEditorStore } from './environmentEditorStore'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import type { RequestDetailsDraft } from './folderExplorerTypes'
import { RequestDetailsResponsePanel } from './RequestDetailsResponsePanel'
import { requestExecutionStore } from './requestExecutionStore'
import { useScriptPackageArtifacts } from './useScriptPackages'
import { useVisibleSharedScripts } from './useVisibleSharedScripts'
import { buildEnvironmentScope, createVariableValueMap } from './environmentScope'
import { DropdownSelect } from '@/lib/components/dropdown-select'

const MCP_META_TABS = ['explore', 'invoke', 'resources', 'prompts', 'scripts', 'tests', 'raw', 'settings'] as const

type McpMetaTab = (typeof MCP_META_TABS)[number]

export function McpRequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [isFetchingIntrospection, setIsFetchingIntrospection] = useState(false)
  const [isInvoking, setIsInvoking] = useState(false)
  const { artifacts: scriptPackageArtifacts } = useScriptPackageArtifacts()
  const selectedRequestId = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request' ? state.context.selected.id : null
  )
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const inactiveFolderEnvironmentIds = useSelector(
    folderExplorerEditorStore,
    state => state.context.inactiveFolderEnvironmentIds
  )
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const selectedRequestFolderId = useSelector(folderExplorerTreeStore, state => {
    const request = state.context.items.find(
      (item): item is Extract<(typeof state.context.items)[number], { itemType: 'request' }> =>
        item.itemType === 'request' && item.id === selectedRequestId
    )

    return request?.parentFolderId ?? null
  })
  const { scripts: visibleSharedScripts } = useVisibleSharedScripts(selectedRequestFolderId)
  const selectedRequestMetaTab = useSelector(folderExplorerEditorStore, state =>
    state.context.selected?.itemType === 'request'
      ? (state.context.tabs.find(tab => tab.id === state.context.activeTabId)?.requestMetaTab ?? null)
      : null
  )
  const scopedEnvironments = useMemo(
    () =>
      buildEnvironmentScope({
        environments,
        environmentEntries,
        activeEnvironmentIds,
        inactiveFolderEnvironmentIds,
        explorerItems,
        folderId: selectedRequestFolderId,
      }),
    [
      activeEnvironmentIds,
      environmentEntries,
      environments,
      explorerItems,
      inactiveFolderEnvironmentIds,
      selectedRequestFolderId,
    ]
  )

  const metaTab = useMemo<McpMetaTab>(() => {
    if (!selectedRequestMetaTab) {
      return 'explore'
    }

    return isMcpMetaTab(selectedRequestMetaTab) ? selectedRequestMetaTab : 'explore'
  }, [selectedRequestMetaTab])

  useEffect(() => {
    if (!selectedRequestId || selectedRequestMetaTab) {
      return
    }

    void FolderExplorerCoordinator.updateSelectedRequestMetaTab('explore')
  }, [selectedRequestId, selectedRequestMetaTab])

  const updateRequestDraft = useCallback(
    (nextDraft: RequestDetailsDraft, debugLabel?: string) => {
      if (!selectedRequestId) {
        return false
      }

      return FolderExplorerCoordinator.updateSelectedDraftIfMatching(
        { itemType: 'request', id: selectedRequestId },
        nextDraft,
        debugLabel
      )
    },
    [selectedRequestId]
  )

  const updateMetaTab = useCallback(
    (nextMetaTab: McpMetaTab) => {
      if (!selectedRequestId) {
        return
      }

      void FolderExplorerCoordinator.updateSelectedRequestMetaTab(nextMetaTab)
    },
    [selectedRequestId]
  )

  const introspectionSnapshot = useMemo(
    () => parseMcpIntrospectionSnapshot(draft.mcpIntrospection),
    [draft.mcpIntrospection]
  )
  const selectedTool = useMemo(
    () => introspectionSnapshot.tools.find(tool => tool.name === draft.mcpSelectedToolName) ?? null,
    [draft.mcpSelectedToolName, introspectionSnapshot.tools]
  )
  const selectedResource = useMemo(
    () => introspectionSnapshot.resources.find(resource => resource.uri === draft.mcpSelectedResourceUri) ?? null,
    [draft.mcpSelectedResourceUri, introspectionSnapshot.resources]
  )
  const selectedPrompt = useMemo(
    () => introspectionSnapshot.prompts.find(prompt => prompt.name === draft.mcpSelectedPromptName) ?? null,
    [draft.mcpSelectedPromptName, introspectionSnapshot.prompts]
  )
  const visualizerEnvironments = useMemo(
    () =>
      scopedEnvironments.tooltipEnvironments.map(environment => {
        return {
          id: environment.id,
          name: environment.name,
          isActive: environment.isActive,
          priority: environment.priority,
          createdAt: environment.createdAt,
          values: Object.fromEntries(createVariableValueMap(environment).entries()),
        }
      }),
    [scopedEnvironments.tooltipEnvironments]
  )
  const responsePanelRequestDraft = useMemo(
    () => ({
      method: 'POST' as const,
      url: draft.mcpServerUrl,
      pathParams: '',
      searchParams: '',
      auth: draft.auth,
      headers: draft.mcpAccessToken.trim() ? `Authorization: Bearer ${draft.mcpAccessToken.trim()}` : '',
      body: draft.mcpArguments,
      bodyType: 'raw' as const,
      rawType: 'json' as const,
    }),
    [draft.auth, draft.mcpAccessToken, draft.mcpArguments, draft.mcpServerUrl]
  )
  const visualizerSharedScripts = useMemo(
    () => visibleSharedScripts.filter(script => script.targets.includes('response-visualizer')),
    [visibleSharedScripts]
  )

  const refreshIntrospection = useCallback(async () => {
    if (!selectedRequestId) {
      return
    }

    setIsFetchingIntrospection(true)
    try {
      const result = await getWindowElectron().fetchMcpIntrospection({
        requestId: selectedRequestId,
        transport: draft.mcpTransport,
        serverUrl: draft.mcpServerUrl,
        accessToken: draft.mcpAccessToken || undefined,
        tlsVerificationMode: draft.tlsVerificationMode,
      })
      if (!result.success) {
        toast.show(result)
        return
      }

      updateRequestDraft(
        {
          ...draft,
          mcpIntrospection: result.data.introspection,
          mcpSelectedToolName: draft.mcpSelectedToolName || result.data.tools[0]?.name || '',
          mcpSelectedResourceUri: draft.mcpSelectedResourceUri || result.data.resources[0]?.uri || '',
          mcpSelectedPromptName: draft.mcpSelectedPromptName || result.data.prompts[0]?.name || '',
        },
        'mcp-introspection-refresh'
      )

      toast.show({
        severity: 'success',
        title: 'Fetched MCP introspection',
        message: `${result.data.tools.length} tools, ${result.data.resources.length} resources, ${result.data.prompts.length} prompts loaded.`,
      })
    } finally {
      setIsFetchingIntrospection(false)
    }
  }, [draft, selectedRequestId, updateRequestDraft])

  const invokeRequest = useCallback(async () => {
    if (!selectedRequestId) {
      return
    }

    setIsInvoking(true)
    try {
      const sentAt = Date.now()
      requestExecutionStore.trigger.requestStarted({ requestId: selectedRequestId, sentAt })
      requestExecutionStore.trigger.httpSseStreamCleared({ requestId: selectedRequestId })

      const result = await getWindowElectron().invokeMcpRequest({
        requestId: selectedRequestId,
        transport: draft.mcpTransport,
        serverUrl: draft.mcpServerUrl,
        accessToken: draft.mcpAccessToken || undefined,
        tlsVerificationMode: draft.tlsVerificationMode,
        toolName: draft.mcpSelectedToolName,
        argumentsJson: draft.mcpArguments,
      })

      if (!result.success) {
        const error = errorResponseToMessage(result.error)
        requestExecutionStore.trigger.requestFailed({ requestId: selectedRequestId, error })
        toast.show(result)
        return
      }

      requestExecutionStore.trigger.requestSucceeded({
        requestId: selectedRequestId,
        requestName: draft.name,
        requestDraft: draft,
        response: result.data,
      })
    } catch {
      return
    } finally {
      setIsInvoking(false)
    }
  }, [draft, selectedRequestId])

  useEffect(() => {
    if (metaTab !== 'invoke') {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (!isInvoking) {
          void invokeRequest()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [invokeRequest, isInvoking, metaTab])

  const handleJumpToScriptError = useCallback(
    (error: { phase: 'pre-request' | 'post-request' | 'test'; line?: number | null; column?: number | null }) => {
      switch (error.phase) {
        case 'pre-request':
        case 'post-request':
          updateMetaTab('scripts')
          return
        case 'test':
          updateMetaTab('tests')
          return
      }
    },
    [updateMetaTab]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="w-full border-b border-base-content/10">
        <div className="grid w-full border border-base-content/10 bg-base-content/10 md:grid-cols-[126px_minmax(0,1fr)_minmax(220px,320px)_auto]">
          <DropdownSelect
            value={draft.mcpTransport}
            className="z-20 bg-base-200/55 md:border-r md:border-base-content/10"
            triggerClassName="tracking-[0.08em]"
            menuClassName="w-[160px]"
            options={[{ value: 'http', label: 'HTTP' }]}
            renderValue={option => option.label}
            onChange={value => updateRequestDraft({ ...draft, mcpTransport: value as 'http' }, 'mcp-transport')}
          />

          <div className="min-w-0 bg-base-100/70 md:border-r md:border-base-content/10">
            <CodeEditor
              testId="mcp-server-url-editor"
              value={draft.mcpServerUrl}
              language="plain"
              singleLine
              compact
              linePaddingOverride="0 1rem !important"
              className="w-full border-0"
              placeholder="http://127.0.0.1:53749/mcp"
              onChange={value => updateRequestDraft({ ...draft, mcpServerUrl: value }, 'mcp-server-url')}
            />
          </div>

          <input
            type="text"
            className="h-[42px] min-w-0 border-0 border-t border-base-content/10 bg-base-100 px-4 text-sm text-base-content outline-none md:border-t-0 md:border-r md:border-base-content/10"
            value={draft.mcpAccessToken}
            placeholder="Bearer token"
            onChange={event => updateRequestDraft({ ...draft, mcpAccessToken: event.target.value }, 'mcp-access-token')}
          />

          <button
            type="button"
            className="shrink-0 border-0 border-t border-base-content/10 bg-base-200 px-4 py-2 text-sm font-medium text-base-content transition hover:bg-base-300 md:border-t-0"
            onClick={() => void refreshIntrospection()}
          >
            {isFetchingIntrospection ? 'Refreshing...' : 'Refresh Introspection'}
          </button>
        </div>

        <McpTabBar metaTab={metaTab} onMetaTabChange={updateMetaTab} summary={introspectionSnapshot.summary} />
      </section>

      {metaTab === 'explore' ? (
        <section className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <DetailsTextArea
            label="Introspection Cache"
            value={draft.mcpIntrospection}
            minHeightClassName="min-h-0 h-full"
            sectionClassName="flex min-h-0 flex-1 flex-col lg:border-r lg:border-base-content/10"
            editorLanguage="json"
            editorSize="small"
            showLineNumbers
            placeholder="Paste or cache MCP server introspection JSON here."
            onChange={value => updateRequestDraft({ ...draft, mcpIntrospection: value }, 'mcp-introspection')}
            onBlur={() => undefined}
          />

          <section className="min-h-0 overflow-auto bg-base-100/45 p-4 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">Snapshot</div>
            <div className="mt-3 space-y-3 text-base-content/75">
              <SummaryRow label="Status" value={introspectionSnapshot.summary.status} />
              <SummaryRow label="Server" value={introspectionSnapshot.serverLabel} />
              <SummaryRow label="Tools" value={String(introspectionSnapshot.summary.tools)} />
              <SummaryRow label="Resources" value={String(introspectionSnapshot.summary.resources)} />
              <SummaryRow label="Prompts" value={String(introspectionSnapshot.summary.prompts)} />
            </div>
          </section>
        </section>
      ) : null}

      {metaTab === 'invoke' ? (
        <section className="min-h-0 flex-1 overflow-hidden">
          <div className="grid h-full min-h-0 xl:grid-cols-[320px_minmax(0,1fr)]">
            <section className="min-h-0 overflow-auto bg-base-100/55 p-4 xl:border-r xl:border-base-content/10">
              <EntityList
                title="Tools"
                items={introspectionSnapshot.tools.map(tool => ({
                  id: tool.name,
                  title: tool.name,
                  subtitle: tool.description || 'No description',
                  isActive: draft.mcpSelectedToolName === tool.name,
                  onClick: () => updateRequestDraft({ ...draft, mcpSelectedToolName: tool.name }, 'mcp-select-tool'),
                }))}
              />
            </section>

            <section className="min-h-0 overflow-auto bg-base-100/55 p-4">
              <div className="space-y-4">
                <section className="flex items-center justify-between">
                  <div>
                    <FieldLabel label="Name" />
                    <div className="mt-2">
                      {selectedTool ? (
                        <div className="text-sm text-base-content/70">{selectedTool.name}</div>
                      ) : (
                        <EmptyDetail message="Select a tool from the sidebar." />
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="justify-self-end rounded-xl border border-base-content/10 bg-base-200 px-4 py-2 text-sm font-medium text-base-content transition hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!draft.mcpSelectedToolName || isInvoking}
                    onClick={() => void invokeRequest()}
                  >
                    {isInvoking ? 'Invoking...' : 'Invoke'}
                  </button>
                </section>

                <InvokeSection title="Description">
                  {selectedTool ? (
                    <div className="text-sm text-base-content/70">{selectedTool.description || 'No description'}</div>
                  ) : (
                    <EmptyDetail message="No tool selected." />
                  )}
                </InvokeSection>

                <InvokeSection title="Schema">
                  {selectedTool ? (
                    <div className="rounded-xl border border-base-content/10 bg-base-200/45 p-3">
                      {selectedTool.inputSchema ? (
                        <JsonPreview value={selectedTool.inputSchema} />
                      ) : (
                        <div className="text-sm text-base-content/45">This tool does not expose an input schema.</div>
                      )}
                    </div>
                  ) : (
                    <EmptyDetail message="Select a tool to inspect its input schema." />
                  )}
                </InvokeSection>

                <InvokeSection title="Body">
                  <DetailsTextArea
                    label={null}
                    value={draft.mcpArguments}
                    editorLanguage="json"
                    editorSize="small"
                    showLineNumbers
                    minHeightClassName="min-h-[280px]"
                    placeholder={`{\n  "query": "users"\n}`}
                    onChange={value => updateRequestDraft({ ...draft, mcpArguments: value }, 'mcp-arguments')}
                    onBlur={() => undefined}
                  />
                </InvokeSection>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {metaTab === 'resources' ? (
        <section className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <section className="rounded-2xl border border-base-content/10 bg-base-100/55 p-4">
              <EntityList
                title="Resources"
                items={introspectionSnapshot.resources.map(resource => ({
                  id: resource.uri,
                  title: resource.name,
                  subtitle: resource.uri,
                  isActive: draft.mcpSelectedResourceUri === resource.uri,
                  onClick: () =>
                    updateRequestDraft({ ...draft, mcpSelectedResourceUri: resource.uri }, 'mcp-select-resource'),
                }))}
              />
            </section>

            <section className="rounded-2xl border border-base-content/10 bg-base-100/55 p-4">
              <FieldLabel label="Resource Details" />
              <div className="mt-2">
                <SelectionDetailsCard
                  title="Resource"
                  emptyLabel="Select a resource to inspect it here."
                  primary={selectedResource?.name ?? ''}
                  secondary={selectedResource?.description || selectedResource?.uri || 'No description'}
                  metadata={
                    selectedResource
                      ? [
                          { label: 'URI', value: selectedResource.uri },
                          { label: 'MIME Type', value: selectedResource.mimeType ?? 'Unknown' },
                        ]
                      : []
                  }
                />
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {metaTab === 'prompts' ? (
        <section className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <section className="rounded-2xl border border-base-content/10 bg-base-100/55 p-4">
              <EntityList
                title="Prompts"
                items={introspectionSnapshot.prompts.map(prompt => ({
                  id: prompt.name,
                  title: prompt.name,
                  subtitle: prompt.description || 'No description',
                  isActive: draft.mcpSelectedPromptName === prompt.name,
                  onClick: () =>
                    updateRequestDraft({ ...draft, mcpSelectedPromptName: prompt.name }, 'mcp-select-prompt'),
                }))}
              />
            </section>

            <section className="rounded-2xl border border-base-content/10 bg-base-100/55 p-4">
              <FieldLabel label="Prompt Details" />
              <div className="mt-2">
                <SelectionDetailsCard
                  title="Prompt"
                  emptyLabel="Select a prompt to inspect it here."
                  primary={selectedPrompt?.name ?? ''}
                  secondary={selectedPrompt?.description || 'No description'}
                  metadata={
                    selectedPrompt ? [{ label: 'Arguments', value: String(selectedPrompt.arguments.length) }] : []
                  }
                >
                  {selectedPrompt?.arguments.length ? (
                    <div className="space-y-2">
                      {selectedPrompt.arguments.map(argument => (
                        <div
                          key={argument.name}
                          className="rounded-xl border border-base-content/10 bg-base-100/70 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-3 text-sm font-medium text-base-content">
                            <span className="truncate">{argument.name}</span>
                            <span className="text-[11px] uppercase tracking-[0.18em] text-base-content/45">
                              {argument.required ? 'Required' : 'Optional'}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-base-content/55">
                            {argument.description || 'No description'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </SelectionDetailsCard>
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {metaTab === 'settings' ? (
        <SettingsTab>
          <SettingsDropdownFieldRow
            title="TLS verification"
            description="Override how this MCP request verifies HTTPS certificates."
            value={draft.tlsVerificationMode}
            options={buildTlsVerificationModeDropdownOptions(REQUEST_TLS_VERIFICATION_MODES)}
            onChange={value =>
              updateRequestDraft({ ...draft, tlsVerificationMode: value }, 'mcp-tls-verification-mode')
            }
          />
        </SettingsTab>
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
            onChange={value => updateRequestDraft({ ...draft, preRequestScript: value }, 'mcp-pre-script')}
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
            onChange={value => updateRequestDraft({ ...draft, postRequestScript: value }, 'mcp-post-script')}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      {metaTab === 'tests' ? (
        <section className="min-h-0 flex-1">
          <DetailsTextArea
            label="Test Script"
            value={draft.testScript}
            minHeightClassName="min-h-0 h-full"
            sectionClassName="flex min-h-0 flex-1 flex-col"
            editorLanguage="javascript"
            editorSize="small"
            showLineNumbers
            onChange={value => updateRequestDraft({ ...draft, testScript: value }, 'mcp-test-script')}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      {metaTab === 'raw' ? (
        <section className="min-h-0 flex-1">
          <DetailsTextArea
            label="Raw Invocation Payload"
            value={draft.mcpArguments}
            minHeightClassName="min-h-0 h-full"
            sectionClassName="flex min-h-0 flex-1 flex-col"
            editorLanguage="json"
            editorSize="small"
            showLineNumbers
            placeholder={`{\n  "name": "tool_name",\n  "arguments": {}\n}`}
            onChange={value => updateRequestDraft({ ...draft, mcpArguments: value }, 'mcp-raw-payload')}
            onBlur={() => undefined}
          />
        </section>
      ) : null}

      <RequestDetailsResponsePanel
        isSending={isInvoking}
        requestName={draft.name}
        requestHeaders={responsePanelRequestDraft.headers}
        requestBody={draft.mcpArguments}
        requestBodyType="raw"
        requestRawType="json"
        requestGraphqlQuery=""
        requestGraphqlVariables=""
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

function McpTabBar({
  metaTab,
  onMetaTabChange,
  summary,
}: {
  metaTab: McpMetaTab
  onMetaTabChange: (tab: McpMetaTab) => void
  summary: ReturnType<typeof summarizeMcpIntrospection>
}) {
  return (
    <div className="flex min-h-10 items-center border-b border-base-content/10 text-xs text-base-content/50">
      <div className="flex min-w-0 items-center">
        {MCP_META_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            className={[
              'h-10 border-r border-base-content/10 px-3 text-xs font-semibold capitalize transition',
              metaTab === tab
                ? 'border-b-2 border-b-base-content text-base-content'
                : 'border-b-2 border-b-transparent text-base-content/45 hover:text-base-content/75',
            ].join(' ')}
            onClick={() => onMetaTabChange(tab)}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      <div className="ml-auto max-w-[60%] overflow-auto px-3 text-right whitespace-nowrap [scrollbar-width:thin]">
        {summary.status === 'Ready'
          ? `${summary.tools} tools, ${summary.resources} resources, ${summary.prompts} prompts`
          : 'No cached MCP introspection yet'}
      </div>
    </div>
  )
}

function FieldLabel({ label }: { label: ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{label}</div>
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/45">{label}</div>
      <div className="mt-1 break-all text-sm text-base-content">{value}</div>
    </div>
  )
}

function InvokeSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <FieldLabel label={title} />
      <div className="mt-2">{children}</div>
    </section>
  )
}

function EmptyDetail({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-base-content/10 bg-base-100/50 px-3 py-3 text-sm text-base-content/45">
      {message}
    </div>
  )
}

function SelectionDetailsCard({
  title,
  emptyLabel,
  primary,
  secondary,
  metadata,
  children,
}: {
  title: string
  emptyLabel: string
  primary: string
  secondary: string
  metadata: Array<{ label: string; value: string }>
  children?: ReactNode
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      {!primary ? (
        <div className="mt-2 rounded-2xl border border-dashed border-base-content/10 bg-base-100/50 px-3 py-3 text-sm text-base-content/45">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-2 rounded-2xl border border-base-content/10 bg-base-100/70 p-3">
          <div className="text-sm font-medium text-base-content">{primary}</div>
          <div className="mt-1 break-words text-xs text-base-content/55">{secondary}</div>
          {metadata.length ? (
            <div className="mt-3 space-y-2">
              {metadata.map(item => (
                <SummaryRow key={`${title}-${item.label}`} label={item.label} value={item.value} />
              ))}
            </div>
          ) : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
      )}
    </div>
  )
}

function JsonPreview({ value }: { value: Record<string, unknown> }) {
  return (
    <pre className="overflow-auto text-xs leading-6 text-base-content/75 whitespace-pre-wrap break-words [scrollbar-width:thin]">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function EntityList({
  title,
  items,
}: {
  title: string
  items: Array<{ id: string; title: string; subtitle: string; isActive: boolean; onClick: () => void }>
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-base-content/45">{title}</div>
      <div className="mt-2 space-y-1">
        {items.length === 0 ? <div className="text-sm text-base-content/45">None</div> : null}
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            className={[
              'w-full rounded-xl border px-3 py-2 text-left transition',
              item.isActive
                ? 'border-base-content/20 bg-base-200/60 text-base-content'
                : 'border-base-content/10 bg-base-100/60 text-base-content/75 hover:border-base-content/15 hover:bg-base-100',
            ].join(' ')}
            onClick={item.onClick}
          >
            <div className="truncate text-sm font-medium">{item.title}</div>
            <div className="truncate text-xs text-base-content/50">{item.subtitle}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function isMcpMetaTab(value: RequestMetaTab): value is McpMetaTab {
  return MCP_META_TABS.includes(value as McpMetaTab)
}

function summarizeMcpIntrospection(value: string) {
  if (!value.trim()) {
    return {
      status: 'Empty',
      tools: 0,
      resources: 0,
      prompts: 0,
    } as const
  }

  try {
    const parsed = JSON.parse(value) as {
      tools?: unknown[]
      resources?: unknown[]
      prompts?: unknown[]
    }

    return {
      status: 'Ready',
      tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      resources: Array.isArray(parsed.resources) ? parsed.resources.length : 0,
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts.length : 0,
    } as const
  } catch {
    return {
      status: 'Invalid JSON',
      tools: 0,
      resources: 0,
      prompts: 0,
    } as const
  }
}

function parseMcpIntrospectionSnapshot(value: string) {
  const summary = summarizeMcpIntrospection(value)
  if (summary.status !== 'Ready') {
    return {
      summary,
      serverLabel: 'Unknown',
      tools: [] as McpToolSummary[],
      resources: [] as McpResourceSummary[],
      prompts: [] as McpPromptSummary[],
    }
  }

  try {
    const parsed = JSON.parse(value) as {
      server?: { name?: string | null; version?: string | null }
      tools?: Array<{ name?: string; description?: string; inputSchema?: Record<string, unknown> | null }>
      resources?: Array<{ uri?: string; name?: string; description?: string; mimeType?: string | null }>
      prompts?: Array<{
        name?: string
        description?: string
        arguments?: Array<{ name?: string; description?: string; required?: boolean }>
      }>
    }

    return {
      summary,
      serverLabel: [parsed.server?.name, parsed.server?.version].filter(Boolean).join(' ') || 'Unknown',
      tools: (parsed.tools ?? []).flatMap(tool =>
        tool.name
          ? [{ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema ?? null }]
          : []
      ),
      resources: (parsed.resources ?? []).flatMap(resource =>
        resource.uri && resource.name
          ? [
              {
                uri: resource.uri,
                name: resource.name,
                description: resource.description ?? '',
                mimeType: resource.mimeType ?? null,
              },
            ]
          : []
      ),
      prompts: (parsed.prompts ?? []).flatMap(prompt =>
        prompt.name
          ? [
              {
                name: prompt.name,
                description: prompt.description ?? '',
                arguments: (prompt.arguments ?? []).flatMap(argument =>
                  argument.name
                    ? [
                        {
                          name: argument.name,
                          description: argument.description ?? '',
                          required: argument.required ?? false,
                        },
                      ]
                    : []
                ),
              },
            ]
          : []
      ),
    }
  } catch {
    return {
      summary: {
        status: 'Invalid JSON',
        tools: 0,
        resources: 0,
        prompts: 0,
      } as const,
      serverLabel: 'Unknown',
      tools: [] as McpToolSummary[],
      resources: [] as McpResourceSummary[],
      prompts: [] as McpPromptSummary[],
    }
  }
}
