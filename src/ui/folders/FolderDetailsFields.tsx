import { useMemo, useRef } from 'react'
import { InfoIcon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { resolveEnvironmentVariables } from '@common/EnvironmentVariables'
import { buildEnvironmentVariableMap } from '@common/RequestVariables'
import { dialogActions } from '@/global/dialogStore'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { FolderDetailsDraft } from './folderExplorerTypes'
import { DetailsTextArea } from './DetailsTextArea'
import { HeadersEditor } from './HeadersEditor'
import { AuthorizationEditor } from './AuthorizationEditor'
import { ScriptDocumentationDialog } from './ScriptDocumentationDialog'
import { variableAutocompleteExtension, type VariableAutocompleteItem } from './codeEditorVariableAutocomplete'
import { variableHighlightExtension } from './codeEditorVariableHighlight'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { environmentEditorStore } from './environmentEditorStore'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'

export function FolderDetailsFields({ draft }: { draft: FolderDetailsDraft }) {
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const environmentEntries = useSelector(environmentEditorStore, state => state.context.entries)
  const activeEnvironmentNames = useMemo(
    () => environments.filter(environment => activeEnvironmentIds.includes(environment.id)).map(environment => environment.name),
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
          valueByVariableName: new Map(Array.from(resolveEnvironmentVariables({ variables }).entries()).map(([key, row]) => [key, row.value])),
        }
      }),
    [activeEnvironmentIds, environmentEntries, environments]
  )

  const variableAutocompleteItems = useMemo<VariableAutocompleteItem[]>(
    () => buildVariableAutocompleteItems(variableTooltipRows),
    [variableTooltipRows]
  )

  const activeEnvironmentVariableNamesRef = useRef(activeEnvironmentVariableNames)
  const variableTooltipRowsRef = useRef(variableTooltipRows)
  const variableAutocompleteItemsRef = useRef(variableAutocompleteItems)

  activeEnvironmentVariableNamesRef.current = activeEnvironmentVariableNames
  variableTooltipRowsRef.current = variableTooltipRows
  variableAutocompleteItemsRef.current = variableAutocompleteItems

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 overflow-y-auto">
      <DetailsTextArea
        label={null}
        value={draft.description}
        minHeightClassName="min-h-28"
        placeholder="Describe what this folder is for"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, description: value })}
        onBlur={() => undefined}
      />

      <AuthorizationEditor
        value={draft.auth}
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, auth: value })}
        allowInherit
        valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
      />

      <HeadersEditor
        value={draft.headers}
        valueEditorExtensions={variableEditorExtensionsWithBrowserTabFallback}
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, headers: value })}
      />
      </div>

      <div className="grid min-h-0 flex-1 md:grid-cols-2">
        <DetailsTextArea
          label="Pre-request Script"
          value={draft.preRequestScript}
          minHeightClassName="min-h-[220px]"
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
          minHeightClassName="min-h-[220px]"
          sectionClassName="flex min-h-0 flex-1 flex-col"
          editorLanguage="javascript"
          editorSize="small"
          extensions={postRequestScriptExtensions}
          headerActions={<ScriptDocumentationButton phase="post-request" />}
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
          onBlur={() => undefined}
        />
      </div>
    </div>
  )
}

function ScriptDocumentationButton({ phase }: { phase: 'pre-request' | 'post-request' }) {
  return (
    <button
      type="button"
      className="grid w-12 place-items-center text-base-content/45 transition hover:bg-base-200/70 hover:text-base-content"
      onClick={() => dialogActions.open({ component: ScriptDocumentationDialog, props: { phase } })}
      aria-label={phase === 'pre-request' ? 'Open pre-request script documentation' : 'Open post-request script documentation'}
      title="Script documentation"
    >
      <InfoIcon className="size-3.5" />
    </button>
  )
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
    ? stringifyKeyValueRows(rows.map(currentRow => (currentRow.key.trim() === variableName ? { ...currentRow, value } : currentRow)))
    : entry.current.variables

  environmentEditorStore.trigger.draftUpdated({
    id: environmentId,
    draft: {
      ...entry.current,
      variables: nextVariables,
    },
  })
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
