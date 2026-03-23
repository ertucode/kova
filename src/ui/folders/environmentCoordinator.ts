import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { environmentEditorStore, isEnvironmentEntryDirty } from './environmentEditorStore'
import { folderExplorerEditorStore, saveFolderExplorerUiState } from './folderExplorerEditorStore'

const saveTokens: Record<string, number> = {}

export namespace EnvironmentCoordinator {
  export async function loadEnvironments() {
    environmentEditorStore.trigger.loadingStarted()

    try {
      const items = await getWindowElectron().listEnvironments()
      environmentEditorStore.trigger.listLoaded({ items })
      folderExplorerEditorStore.trigger.activeEnvironmentIdsReconciled({ ids: items.map(item => item.id) })
      persistUiState()
    } catch (error) {
      environmentEditorStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load environments',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function selectEnvironment(id: string | null) {
    environmentEditorStore.trigger.selectedChanged({ id })
  }

  export function openEnvironmentDetails(id: string) {
    setSidebarTab('environments')
    selectEnvironment(id)
  }

  export async function createEnvironment() {
    const result = await getWindowElectron().createEnvironment({ name: 'New Environment' })
    if (!result.success) {
      toast.show(result)
      return
    }

    environmentEditorStore.trigger.itemAdded({ item: result.data })
  }

  export async function duplicateSelectedEnvironment() {
    const selectedId = environmentEditorStore.getSnapshot().context.selectedId
    if (!selectedId) {
      return
    }

    const result = await getWindowElectron().duplicateEnvironment({ id: selectedId })
    if (!result.success) {
      toast.show(result)
      return
    }

    await loadEnvironments()
    selectEnvironment(result.data.id)
    toast.show({ severity: 'success', title: 'Environment duplicated', message: `Created ${result.data.name}.` })
  }

  export function updateDraft(
    id: string,
    draft: { name: string; variables: string; color: string | null; warnOnRequest: boolean; priority: number }
  ) {
    environmentEditorStore.trigger.draftUpdated({ id, draft })
  }

  export async function moveEnvironment(id: string, targetPosition: number) {
    const result = await getWindowElectron().moveEnvironment({ id, targetPosition })
    if (!result.success) {
      toast.show(result)
      return false
    }

    await loadEnvironments()
    selectEnvironment(id)
    return true
  }

  export async function saveEnvironment(id: string) {
    const state = environmentEditorStore.getSnapshot().context
    const entry = state.entries[id]
    if (!entry?.current || !isEnvironmentEntryDirty(entry)) {
      return
    }

    const version = entry.version
    const token = (saveTokens[id] ?? 0) + 1
    saveTokens[id] = token
    environmentEditorStore.trigger.entrySavingStarted({ id })

    const result = await getWindowElectron().updateEnvironment({
      id,
        name: entry.current.name,
        variables: entry.current.variables,
        color: entry.current.color,
        warnOnRequest: entry.current.warnOnRequest,
        priority: entry.current.priority,
      })

    if (saveTokens[id] !== token) {
      return
    }

    if (!result.success) {
      environmentEditorStore.trigger.entrySaveFailed({ id, error: errorResponseToMessage(result.error) })
      toast.show(result)
      return
    }

    environmentEditorStore.trigger.entrySaved({ item: result.data, version })
  }

  export function requestDeleteEnvironment(id: string, name: string) {
    confirmation.trigger.confirm({
      title: 'Delete environment?',
      message: `"${name}" will be deleted.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        const result = await getWindowElectron().deleteEnvironment({ id })
        if (!result.success) {
          toast.show(result)
          return
        }

        environmentEditorStore.trigger.itemDeleted({ id })
        folderExplorerEditorStore.trigger.activeEnvironmentIdsReconciled({
          ids: environmentEditorStore.getSnapshot().context.items.map(item => item.id),
        })
        persistUiState()
      },
    })
  }

  export function toggleActiveEnvironment(id: string) {
    folderExplorerEditorStore.trigger.activeEnvironmentToggled({ id })
    persistUiState()
  }

  export function setSidebarTab(sidebarTab: 'requests' | 'environments' | 'history') {
    folderExplorerEditorStore.trigger.sidebarTabChanged({ sidebarTab })
    persistUiState()
  }
}

function persistUiState() {
  const { selected, expandedIds } = folderExplorerEditorStore.getSnapshot().context
  saveFolderExplorerUiState(selected, expandedIds)
}
