import type { FolderRecord } from '@common/Folders'
import { errorResponseToMessage } from '@common/GenericError'
import type { HttpRequestRecord } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { saveToAsyncStorage } from '@/utils/asyncStorage'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import type { ExplorerItem } from '@common/Explorer'
import type { DetailsDraft, Selection } from './folderExplorerTypes'
import {
  createEmptyEntry,
  folderExplorerEditorStore,
  isEntryDirty,
  persistedDraftsSchema,
  saveLastSelectedTreeItem,
} from './folderExplorerEditorStore'
import { folderExplorerTreeStore, getDeletedItemKeys } from './folderExplorerTreeStore'
import { serializeDetails, toFolderDetailsDraft, toRequestDetailsDraft, toSelectionKey } from './folderExplorerUtils'

const loadTokens: Record<string, number> = {}
const saveTokens: Record<string, number> = {}

export namespace FolderExplorerCoordinator {
  export async function loadItems() {
    folderExplorerTreeStore.trigger.loadingStarted()

    try {
      const items = await getWindowElectron().listExplorerItems()
      folderExplorerTreeStore.trigger.itemsLoaded({ items })

      const selected = folderExplorerEditorStore.getSnapshot().context.selected
      const nextSelection =
        selected && items.some(item => item.id === selected.id && item.itemType === selected.itemType)
          ? selected
          : items[0]
            ? { itemType: items[0].itemType, id: items[0].id }
            : null

      selectItem(nextSelection)
    } catch (error) {
      folderExplorerTreeStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load explorer items',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function selectItem(selection: Selection | null) {
    const state = folderExplorerEditorStore.getSnapshot().context
    const current = state.selected

    if (isSameSelection(current, selection)) {
      if (selection) {
        const key = toSelectionKey(selection)
        const entry = state.entries[key]
        if (!entry?.base) {
          void loadItem(selection)
        }
      }
      return
    }

    folderExplorerEditorStore.trigger.selectionChanged({ selection })
    saveLastSelectedTreeItem(selection)

    if (selection) {
      void loadItem(selection)
    }
  }

  export function updateSelectedDraft(draft: DetailsDraft | null) {
    if (!draft) return
    folderExplorerEditorStore.trigger.selectedDraftUpdated({ draft })
    persistUnsavedDrafts()
  }

  export async function saveSelectedItem() {
    const selection = folderExplorerEditorStore.getSnapshot().context.selected
    if (!selection) return
    await saveItem(selection)
  }

  export async function flushSelectedFolder() {
    const state = folderExplorerEditorStore.getSnapshot().context
    const selection = state.selected
    if (!selection || selection.itemType !== 'folder') return

    const entry = state.entries[toSelectionKey(selection)]
    if (!entry || !isEntryDirty(entry)) return

    await saveItem(selection)
  }

  export function startCreate(itemType: ExplorerItem['itemType'], parentFolderId: string | null) {
    folderExplorerTreeStore.trigger.createStarted({ itemType, parentFolderId })
    if (parentFolderId) {
      folderExplorerTreeStore.trigger.expandedEnsured({ id: parentFolderId })
      selectItem({ itemType: 'folder', id: parentFolderId })
    }
  }

  export function changeCreateName(name: string) {
    folderExplorerTreeStore.trigger.createNameChanged({ name })
  }

  export function cancelCreate() {
    folderExplorerTreeStore.trigger.createCancelled()
  }

  export async function submitCreate() {
    const createDraft = folderExplorerTreeStore.getSnapshot().context.createDraft
    if (!createDraft) return

    const result =
      createDraft.itemType === 'folder'
        ? await getWindowElectron().createFolder({
            parentFolderId: createDraft.parentFolderId,
            name: createDraft.name,
          })
        : await getWindowElectron().createRequest({
            parentFolderId: createDraft.parentFolderId,
            name: createDraft.name,
          })

    if (!result.success) {
      toast.show(result)
      return
    }

    cancelCreate()
    if (createDraft.parentFolderId) {
      folderExplorerTreeStore.trigger.expandedEnsured({ id: createDraft.parentFolderId })
    }

    await loadItems()
    selectItem({ itemType: createDraft.itemType, id: result.data.id })
  }

  export function requestDelete(item: ExplorerItem) {
    const title = item.itemType === 'folder' ? 'Delete folder?' : 'Delete request?'
    const message = item.itemType === 'folder' ? `"${item.name}" and all nested items will be deleted.` : `"${item.name}" will be deleted.`

    confirmation.trigger.confirm({
      title,
      message,
      confirmText: 'Delete',
      onConfirm: async () => {
        const result =
          item.itemType === 'folder'
            ? await getWindowElectron().deleteFolder({ id: item.id })
            : await getWindowElectron().deleteRequest({ id: item.id })

        if (!result.success) {
          toast.show(result)
          return
        }

        const treeState = folderExplorerTreeStore.getSnapshot().context
        if (treeState.createDraft?.parentFolderId === item.id) {
          cancelCreate()
        }

        const affectedKeys = getDeletedItemKeys(treeState.items, item)
        folderExplorerEditorStore.trigger.itemStatesCleared({ keys: affectedKeys })
        if (folderExplorerEditorStore.getSnapshot().context.selected === null) {
          saveLastSelectedTreeItem(null)
        }
        persistUnsavedDrafts()
        await loadItems()
      },
    })
  }

  export function updateTreeSearchQuery(searchQuery: string) {
    folderExplorerTreeStore.trigger.searchQueryChanged({ searchQuery })
  }

  export function toggleExpanded(id: string) {
    folderExplorerTreeStore.trigger.expandedToggled({ id })
  }
}

async function loadItem(selection: Selection) {
  const key = toSelectionKey(selection)
  const token = (loadTokens[key] ?? 0) + 1
  loadTokens[key] = token
  folderExplorerEditorStore.trigger.entryLoadingStarted({ key })

  const result =
    selection.itemType === 'folder'
      ? await getWindowElectron().getFolder({ id: selection.id })
      : await getWindowElectron().getRequest({ id: selection.id })

  if (loadTokens[key] !== token) return

  if (!result.success) {
    folderExplorerEditorStore.trigger.entryLoadFailed({ key, error: errorResponseToMessage(result.error) })
    toast.show(result)
    return
  }

  const serverDraft = toServerDraft(selection, result.data as FolderRecord | HttpRequestRecord)
  const currentEntry = folderExplorerEditorStore.getSnapshot().context.entries[key] ?? createEmptyEntry()
  const current = currentEntry.current && serializeDetails(currentEntry.current) !== serializeDetails(serverDraft) ? currentEntry.current : serverDraft

  folderExplorerEditorStore.trigger.entryLoaded({ key, base: serverDraft, current })
  folderExplorerTreeStore.trigger.itemNameUpdated({ selection, name: result.data.name })
  persistUnsavedDrafts()
}

async function saveItem(selection: Selection) {
  const key = toSelectionKey(selection)
  const entry = folderExplorerEditorStore.getSnapshot().context.entries[key]
  if (!entry?.current || !isEntryDirty(entry)) return

  const version = entry.version
  const draft = entry.current
  const token = (saveTokens[key] ?? 0) + 1
  saveTokens[key] = token
  folderExplorerEditorStore.trigger.entrySavingStarted({ key })

  const result =
    draft.itemType === 'folder'
      ? await getWindowElectron().updateFolder({
          id: selection.id,
          name: draft.name,
          description: draft.description,
          preRequestScript: draft.preRequestScript,
          postRequestScript: draft.postRequestScript,
        })
      : await getWindowElectron().updateRequest({
          id: selection.id,
          name: draft.name,
          method: draft.method,
          url: draft.url,
          preRequestScript: draft.preRequestScript,
          postRequestScript: draft.postRequestScript,
          headers: draft.headers,
          body: draft.body,
          bodyType: draft.bodyType,
          rawType: draft.rawType,
        })

  if (saveTokens[key] !== token) return

  if (!result.success) {
    folderExplorerEditorStore.trigger.entrySaveFailed({ key, error: errorResponseToMessage(result.error) })
    toast.show(result)
    return
  }

  const serverDraft = toServerDraft(selection, result.data as FolderRecord | HttpRequestRecord)
  const latestEntry = folderExplorerEditorStore.getSnapshot().context.entries[key] ?? createEmptyEntry()
  const nextCurrent = latestEntry.current && serializeDetails(latestEntry.current) !== serializeDetails(serverDraft) ? latestEntry.current : serverDraft

  folderExplorerEditorStore.trigger.entrySaved({
    key,
    base: serverDraft,
    current: latestEntry.version === version ? serverDraft : nextCurrent,
  })
  folderExplorerTreeStore.trigger.itemNameUpdated({ selection, name: result.data.name })
  persistUnsavedDrafts()
}

function persistUnsavedDrafts() {
  const entries = folderExplorerEditorStore.getSnapshot().context.entries
  const nextPersistedDrafts = Object.fromEntries(
    Object.entries(entries)
      .filter(([, entry]) => entry.current && (entry.base === null || serializeDetails(entry.current) !== serializeDetails(entry.base)))
      .map(([key, entry]) => [key, entry.current as DetailsDraft])
  )

  void saveToAsyncStorage(AsyncStorageKeys.folderExplorerDrafts, persistedDraftsSchema, nextPersistedDrafts)
}

function isSameSelection(left: Selection | null, right: Selection | null) {
  if (!left || !right) return left === right
  return left.id === right.id && left.itemType === right.itemType
}

function toServerDraft(selection: Selection, value: FolderRecord | HttpRequestRecord) {
  return selection.itemType === 'folder' ? toFolderDetailsDraft(value as FolderRecord) : toRequestDetailsDraft(value as HttpRequestRecord)
}
