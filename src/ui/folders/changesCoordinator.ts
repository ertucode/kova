import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import type { OperationRecord } from '@common/Operations'
import { changesStore, type ChangesStatusFilter } from './changesStore'

export namespace ChangesCoordinator {
  export async function loadOperations() {
    changesStore.trigger.loadingStarted()

    try {
      const operations = await getWindowElectron().listOperations()
      changesStore.trigger.operationsLoaded({ operations })
    } catch (error) {
      changesStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load changes',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function setSearchQuery(searchQuery: string) {
    changesStore.trigger.searchQueryChanged({ searchQuery })
  }

  export function setStatusFilter(statusFilter: ChangesStatusFilter) {
    changesStore.trigger.statusFilterChanged({ statusFilter })
  }

  export function toggleSelection(id: string) {
    changesStore.trigger.selectionToggled({ id })
  }

  export function toggleVisibleSelection(ids: string[]) {
    changesStore.trigger.visibleSelectionToggled({ ids })
  }

  export function clearSelection() {
    changesStore.trigger.selectionCleared()
  }

  export async function undoOperation(id: string) {
    const result = await getWindowElectron().undoOperation({ id })
    if (!result.success) {
      toast.show(result)
      return false
    }

    await refreshExplorerState()
    await loadOperations()
    toast.show({ severity: 'success', title: 'Change undone', message: result.data.title })
    return true
  }

  export function requestDeleteOperation(operation: OperationRecord) {
    confirmation.trigger.confirm({
      title: operation.status === 'active' ? 'Delete permanently?' : 'Remove record?',
      message:
        operation.status === 'active'
          ? `"${operation.title}" and its deleted data will be permanently removed.`
          : `"${operation.title}" will be removed from the changes list.`,
      confirmText: operation.status === 'active' ? 'Delete Permanently' : 'Remove Record',
      onConfirm: async () => {
        const result = await getWindowElectron().deleteOperation({ id: operation.id })
        if (!result.success) {
          toast.show(result)
          return
        }

        await loadOperations()
      },
    })
  }

  export function requestBulkDelete(operations: OperationRecord[]) {
    if (operations.length === 0) {
      return
    }

    const activeCount = operations.filter(operation => operation.status === 'active').length
    confirmation.trigger.confirm({
      title: activeCount > 0 ? 'Delete selected permanently?' : 'Remove selected records?',
      message:
        activeCount > 0
          ? `This will permanently delete ${activeCount} change${activeCount === 1 ? '' : 's'} and remove all selected records from the list.`
          : `Remove ${operations.length} change record${operations.length === 1 ? '' : 's'} from the list?`,
      confirmText: activeCount > 0 ? 'Delete Selected' : 'Remove Selected',
      onConfirm: async () => {
        const result = await getWindowElectron().deleteOperations({ ids: operations.map(operation => operation.id) })
        if (!result.success) {
          toast.show(result)
          return
        }

        clearSelection()
        await loadOperations()
      },
    })
  }

  export async function undoSelected(ids: string[]) {
    if (ids.length === 0) {
      return
    }

    const result = await getWindowElectron().undoOperations({ ids })
    if (!result.success) {
      toast.show(result)
      return
    }

    clearSelection()
    await refreshExplorerState()
    await loadOperations()
    toast.show({ severity: 'success', title: 'Selected changes undone' })
  }
}

async function refreshExplorerState() {
  const { FolderExplorerCoordinator } = await import('./folderExplorerCoordinator')
  await FolderExplorerCoordinator.initialize()
}
