import { useMemo } from 'react'
import { useSelector } from '@xstate/store/react'
import { buildEnvironmentVariableMap } from '@common/RequestVariables'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { FolderDetailsDraft } from './folderExplorerTypes'
import { DetailsTextArea } from './DetailsTextArea'
import { scriptAutocompleteExtension } from './codeEditorScriptAutocomplete'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { environmentEditorStore } from './environmentEditorStore'

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
    <>
      <DetailsTextArea
        label={null}
        value={draft.description}
        minHeightClassName="min-h-28"
        placeholder="Describe what this folder is for"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, description: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />

      <DetailsTextArea
        label="Pre-request Script"
        value={draft.preRequestScript}
        minHeightClassName="min-h-40"
        editorLanguage="javascript"
        editorSize="small"
        extensions={preRequestScriptExtensions}
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />

      <DetailsTextArea
        label="Post-request Script"
        value={draft.postRequestScript}
        minHeightClassName="min-h-40"
        editorLanguage="javascript"
        editorSize="small"
        extensions={postRequestScriptExtensions}
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />
    </>
  )
}
