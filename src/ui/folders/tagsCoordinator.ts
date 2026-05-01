import { errorResponseToMessage } from '@common/GenericError'
import type { TaggableItemType } from '@common/Tags'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { ChangesCoordinator } from './changesCoordinator'
import { folderExplorerEditorStore, saveFolderExplorerUiState, type SidebarTab } from './folderExplorerEditorStore'
import { tagsStore } from './tagsStore'

export namespace TagsCoordinator {
  export async function loadTags() {
    tagsStore.trigger.loadingStarted()

    try {
      const [items, assignments] = await Promise.all([
        getWindowElectron().listTags(),
        getWindowElectron().listTagAssignments(),
      ])
      tagsStore.trigger.loaded({ items, assignments })
    } catch (error) {
      tagsStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load tags',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function selectTag(id: string | null) {
    tagsStore.trigger.selectedChanged({ id })
  }

  export function openTagPanel(id: string) {
    setSidebarTab('tags')
    selectTag(id)
  }

  export async function createTag(name = 'New Tag') {
    const result = await getWindowElectron().createTag({ name, color: null })
    if (!result.success) {
      toast.show(result)
      return null
    }

    await loadTags()
    tagsStore.trigger.focusRequested({ id: result.data.id })
    return result.data
  }

  export async function saveTag(input: { id: string; name: string; color: string | null }) {
    const result = await getWindowElectron().updateTag(input)
    if (!result.success) {
      toast.show({ severity: 'error', title: 'Could not save tag', message: errorResponseToMessage(result.error) })
      return null
    }

    await loadTags()
    return result.data
  }

  export async function moveTag(id: string, targetPosition: number) {
    const result = await getWindowElectron().moveTag({ id, targetPosition })
    if (!result.success) {
      toast.show(result)
      return false
    }

    await loadTags()
    selectTag(id)
    return true
  }

  export function requestDeleteTag(id: string, name: string) {
    confirmation.trigger.confirm({
      title: 'Delete tag?',
      message: `"${name}" will be deleted from all items.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        const result = await getWindowElectron().deleteTag({ id })
        if (!result.success) {
          toast.show(result)
          return
        }

        await loadTags()
      },
    })
  }

  export async function replaceItemTags(itemType: TaggableItemType, itemId: string, tagIds: string[]) {
    const result = await getWindowElectron().replaceItemTags({ itemType, itemId, tagIds })
    if (!result.success) {
      toast.show(result)
      return false
    }

    await loadTags()
    void ChangesCoordinator.loadOperations()
    return true
  }

  export async function replaceTagItems(
    tagId: string,
    items: Array<{ itemType: TaggableItemType; itemId: string }>
  ) {
    const result = await getWindowElectron().replaceTagItems({ tagId, items })
    if (!result.success) {
      toast.show(result)
      return false
    }

    await loadTags()
    void ChangesCoordinator.loadOperations()
    return true
  }

  export function setSidebarTab(sidebarTab: SidebarTab) {
    folderExplorerEditorStore.trigger.sidebarTabChanged({ sidebarTab })
    persistUiState()
  }
}

function persistUiState() {
  const { selected, expandedIds } = folderExplorerEditorStore.getSnapshot().context
  saveFolderExplorerUiState(selected, expandedIds)
}
