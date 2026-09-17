import type { SharedScriptScopeType } from '@common/SharedScripts'
import { Typescript } from '@common/Typescript'
import { EnvironmentCoordinator } from './environmentCoordinator'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { getSharedScriptScopeKey, sharedScriptEditorStore } from './sharedScriptEditorStore'

type SharedScriptSource = {
  id: string
  scopeType: SharedScriptScopeType
  scopeId: string | null
}

export namespace SharedScriptCoordinator {
  export async function openScript(source: SharedScriptSource) {
    switch (source.scopeType) {
      case 'workspace':
        EnvironmentCoordinator.setSidebarTab('scripts')
        break
      case 'folder':
        if (!source.scopeId) {
          return
        }

        EnvironmentCoordinator.setSidebarTab('requests')
        await FolderExplorerCoordinator.selectItem({ itemType: 'folder', id: source.scopeId })
        break
      default:
        Typescript.assertUnreachable(source.scopeType)
    }

    const scopeKey = getSharedScriptScopeKey(source.scopeType, source.scopeId)
    sharedScriptEditorStore.trigger.selectedChanged({ scopeKey, id: source.id })
    sharedScriptEditorStore.trigger.focusRequested({ scopeKey, id: source.id })
  }
}
