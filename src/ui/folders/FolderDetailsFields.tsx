import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import type { FolderDetailsDraft } from './folderExplorerTypes'
import { DetailsTextArea } from './DetailsTextArea'

export function FolderDetailsFields({ draft }: { draft: FolderDetailsDraft }) {
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
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, preRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />

      <DetailsTextArea
        label="Post-request Script"
        value={draft.postRequestScript}
        minHeightClassName="min-h-40"
        editorLanguage="javascript"
        onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, postRequestScript: value })}
        onBlur={() => void FolderExplorerCoordinator.flushSelectedFolder()}
      />
    </>
  )
}
