import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSelector } from '@xstate/store/react'
import type { RequestBodyType, RequestMethod, RequestRawType, SendRequestResponse } from '@common/Requests'
import { buildEnvironmentVariableMap, extractTemplateVariables } from '@common/RequestVariables'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { getWindowElectron } from '@/getWindowElectron'
import { errorResponseToMessage } from '@common/GenericError'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { HeadersEditor } from './HeadersEditor'
import { CodeEditor, type CodeEditorLanguage } from './CodeEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { KeyValueEditor } from './KeyValueEditor'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { REQUEST_BODY_TYPES, REQUEST_METHODS, REQUEST_RAW_TYPES, type RequestDetailsDraft } from './folderExplorerTypes'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'

export function RequestDetailsFields({ draft }: { draft: RequestDetailsDraft }) {
  const [response, setResponse] = useState<SendRequestResponse | null>(null)
  const [responseError, setResponseError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isResizingResponsePane, setIsResizingResponsePane] = useState(false)
  const [responsePaneHeight, setResponsePaneHeight] = useState(320)
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
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
        const draft = environmentEntries[environment.id]?.current
        const variables = draft?.variables ?? environment.variables
        const rows = parseKeyValueRows(variables)

        return {
          id: environment.id,
          name: draft?.name ?? environment.name,
          isActive: activeEnvironmentIds.includes(environment.id),
          priority: draft?.priority ?? environment.priority,
          createdAt: environment.createdAt,
          valueByVariableName: new Map(rows.map(row => [row.key.trim(), row.value])),
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
        onChangeValue: (environmentId, variableName, value) =>
          updateEnvironmentVariableDraft(environmentId, variableName, value),
        onSaveValue: environmentId => EnvironmentCoordinator.saveEnvironment(environmentId),
      }),
      variableAutocompleteExtension(() => variableAutocompleteItemsRef.current),
    ],
    []
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

  const referencedVariables = useMemo(
    () =>
      Array.from(
        new Set([
          ...extractTemplateVariables(draft.url),
          ...extractTemplateVariables(draft.headers),
          ...extractTemplateVariables(draft.body),
        ])
      ),
    [draft.body, draft.headers, draft.url]
  )

  const formattedResponseBody = useMemo(() => {
    if (!response) return ''
    return formatResponseBody(response.body, response.headers)
  }, [response])

  const responseContentType = useMemo(() => getResponseContentType(response?.headers ?? ''), [response?.headers])

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
      setResponsePaneHeight(clampResponsePaneHeight(resizeState.startHeight + deltaY))
    }

    const handlePointerUp = () => {
      resizeStateRef.current = null
      setIsResizingResponsePane(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isSending])

  const sendRequest = async () => {
    const state = folderExplorerEditorStore.getSnapshot().context
    const selected = state.selected
    if (!selected || selected.itemType !== 'request') {
      setResponse(null)
      setResponseError('Request selection is missing')
      return
    }

    const entry = state.entries[`request:${selected.id}`]
    const latestDraft = entry?.current
    if (!latestDraft || latestDraft.itemType !== 'request') {
      setResponse(null)
      setResponseError('Request draft is missing')
      return
    }

    setIsSending(true)
    setResponseError(null)

    const result = await getWindowElectron().sendRequest({
      requestId: selected.id,
      method: latestDraft.method,
      url: latestDraft.url,
      preRequestScript: latestDraft.preRequestScript,
      postRequestScript: latestDraft.postRequestScript,
      headers: latestDraft.headers,
      body: latestDraft.body,
      bodyType: latestDraft.bodyType,
      rawType: latestDraft.rawType,
      activeEnvironmentIds: state.activeEnvironmentIds,
    })

    setIsSending(false)

    if (!result.success) {
      setResponse(null)
      setResponseError(errorResponseToMessage(result.error))
      return
    }

    setResponse(result.data)
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
              placeholder="https://api.example.com/resource"
              extensions={variableEditorExtensions}
              onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, url: value })}
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
          activeEnvironmentNames={activeEnvironmentNames}
          referencedVariables={referencedVariables}
        />
      </section>

      <section className="grid min-h-0 flex-1 w-full border-base-content/10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-h-0 border-b border-base-content/10 md:border-b-0 md:border-r md:border-base-content/10">
          <div className="flex h-full min-h-0 flex-col border-b border-base-content/10">
            <div className="flex items-center gap-3">
              <div className="pl-2 text-sm font-semibold text-base-content">Body</div>
              <DropdownSelect
                value={draft.bodyType}
                className="w-[182px]"
                triggerClassName="h-8 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-xs font-medium capitalize"
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
                triggerClassName="h-8 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-xs font-medium uppercase"
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
            </div>

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
              <div className="flex min-h-0 h-full items-center justify-center border border-base-content/10 bg-base-100/35 text-sm text-base-content/45">
                No request body
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto md:border-l md:border-base-content/10">
          <HeadersEditor
            value={draft.headers}
            valueEditorExtensions={variableEditorExtensions}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
          />

          <DetailsTextArea
            label="Pre-request Script"
            value={draft.preRequestScript}
            minHeightClassName="min-h-[100px]"
            sectionClassName="flex min-h-[100px] flex-1 basis-0 flex-col"
            editorLanguage="javascript"
            editorSize="small"
            extensions={preRequestScriptExtensions}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
            onBlur={() => undefined}
          />

          <DetailsTextArea
            label="Post-request Script"
            value={draft.postRequestScript}
            minHeightClassName="min-h-[100px]"
            sectionClassName="flex min-h-[100px] flex-1 basis-0 flex-col"
            editorLanguage="javascript"
            editorSize="small"
            extensions={postRequestScriptExtensions}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
            onBlur={() => undefined}
          />
        </div>
      </section>

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
          <div className="flex items-start justify-between gap-4 border-b border-base-content/10 p-2">
            <div className="text-sm font-semibold text-base-content">Response</div>
            <ResponseStatusSummary response={response} responseError={responseError} />
          </div>
          <ResponseScriptErrors errors={response?.scriptErrors ?? []} />
          <div className="grid md:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.95fr)]">
            <ResponseBodyPanel
              value={formattedResponseBody}
              description="Response body will appear here."
              contentType={responseContentType}
            />
            <ResponseHeadersPanel value={response?.headers ?? ''} description="Response headers will appear here." />
          </div>
        </div>
      </section>
    </div>
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
  activeEnvironmentNames,
  referencedVariables,
}: {
  activeEnvironmentNames: string[]
  referencedVariables: string[]
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-x border-b border-base-content/10 bg-base-100/35 px-3 py-2 text-xs text-base-content/50">
      <span>
        {activeEnvironmentNames.length > 0 ? `Active: ${activeEnvironmentNames.join(', ')}` : 'No active environments'}
      </span>
      {referencedVariables.length > 0 ? <span>Variables: {referencedVariables.join(', ')}</span> : null}
    </div>
  )
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
}: {
  value: string
  description: string
  contentType: string | null
}) {
  return (
    <div className="min-h-32 border border-dashed border-base-content/12 bg-base-100/35 p-2">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium text-base-content">Body</div>
        {contentType ? <div className="text-xs text-base-content/45">{contentType}</div> : null}
      </div>

      {value ? (
        <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-6 text-base-content">
          {value}
        </pre>
      ) : (
        <div className="mt-2 text-sm text-base-content/50">{description}</div>
      )}
    </div>
  )
}

function ResponseHeadersPanel({ value, description }: { value: string; description: string }) {
  const rows = parseResponseHeaders(value)

  return (
    <div className="min-h-32 border border-dashed border-base-content/12 bg-base-100/35 p-2">
      <div className="text-sm font-medium text-base-content">Headers</div>

      {rows.length > 0 ? (
        <div className="mt-3 overflow-auto">
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
  if (!looksJson) {
    return body
  }

  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
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
