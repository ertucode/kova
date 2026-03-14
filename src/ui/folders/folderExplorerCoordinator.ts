import { createElement } from 'react'
import type { FolderRecord } from '@common/Folders'
import { errorResponseToMessage } from '@common/GenericError'
import type { RequestExampleRecord } from '@common/RequestExamples'
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
  saveFolderExplorerUiState,
} from './folderExplorerEditorStore'
import { folderExplorerTreeStore, getDeletedItemKeys } from './folderExplorerTreeStore'
import { serializeDetails, toFolderDetailsDraft, toRequestDetailsDraft, toRequestExampleDetailsDraft, toSelectionKey } from './folderExplorerUtils'
import type { MoveExplorerItemInput } from '@common/Explorer'

const loadTokens: Record<string, number> = {}
const saveTokens: Record<string, number> = {}
const MOVE_UNDO_TOAST_ID = 'folder-explorer-move-undo'
const MOVE_UNDO_TIMEOUT_MS = 5000
const MAX_MOVE_UNDO_STACK_SIZE = 20

type MoveUndoEntry = {
  itemType: 'folder' | 'request'
  id: string
  name: string
  targetParentFolderId: string | null
  targetPosition: number
}

let isUndoingMove = false
const moveUndoStack: MoveUndoEntry[] = []

export namespace FolderExplorerCoordinator {
  export async function loadItems() {
    folderExplorerTreeStore.trigger.loadingStarted()

    try {
      const items = await getWindowElectron().listExplorerItems()
      folderExplorerTreeStore.trigger.itemsLoaded({ items })
      folderExplorerEditorStore.trigger.expandedIdsReconciled({ items })
      persistUiState()

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
    persistUiState()

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

  export async function duplicateSelectedRequest() {
    const selection = folderExplorerEditorStore.getSnapshot().context.selected
    if (!selection || selection.itemType !== 'request') {
      return
    }

    const result = await getWindowElectron().duplicateRequest({ id: selection.id })
    if (!result.success) {
      toast.show(result)
      return
    }

    await loadItems()
    selectItem({ itemType: 'request', id: result.data.id })
    toast.show({ severity: 'success', title: 'Request duplicated', message: `Created ${result.data.name}.` })
  }

  export async function flushSelectedFolder() {
    const state = folderExplorerEditorStore.getSnapshot().context
    const selection = state.selected
    if (!selection || selection.itemType !== 'folder') return

    const entry = state.entries[toSelectionKey(selection)]
    if (!entry || !isEntryDirty(entry)) return

    await saveItem(selection)
  }

  export function startCreate(itemType: Extract<ExplorerItem['itemType'], 'folder' | 'request'>, parentFolderId: string | null) {
    folderExplorerTreeStore.trigger.createStarted({ itemType, parentFolderId })
    if (parentFolderId) {
      folderExplorerEditorStore.trigger.expandedEnsured({ id: parentFolderId })
      persistUiState()
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
      folderExplorerEditorStore.trigger.expandedEnsured({ id: createDraft.parentFolderId })
      persistUiState()
    }

    await loadItems()
    selectItem({ itemType: createDraft.itemType, id: result.data.id })
  }

  export function requestDelete(item: ExplorerItem) {
      const title = item.itemType === 'folder' ? 'Delete folder?' : item.itemType === 'request' ? 'Delete request?' : 'Delete example?'
      const message = item.itemType === 'folder' ? `"${item.name}" and all nested items will be deleted.` : `"${item.name}" will be deleted.`

    confirmation.trigger.confirm({
      title,
      message,
      confirmText: 'Delete',
      onConfirm: async () => {
          const result =
            item.itemType === 'folder'
              ? await getWindowElectron().deleteFolder({ id: item.id })
              : item.itemType === 'request'
                ? await getWindowElectron().deleteRequest({ id: item.id })
                : await getWindowElectron().deleteRequestExample({ id: item.id })

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
        persistUiState()
        persistUnsavedDrafts()
        await loadItems()
      },
    })
  }

  export function updateTreeSearchQuery(searchQuery: string) {
    folderExplorerTreeStore.trigger.searchQueryChanged({ searchQuery })
  }

  export function toggleExpanded(id: string) {
    folderExplorerEditorStore.trigger.expandedToggled({ id })
    persistUiState()
  }

  export async function moveItem(input: MoveExplorerItemInput) {
    if (input.itemType === 'example') {
      const result = await getWindowElectron().moveRequestExample({ id: input.id, requestId: input.targetRequestId, targetPosition: input.targetPosition })
      if (!result.success) {
        toast.show(result)
        return false
      }
      await loadItems()
      return true
    }

    const undoEntry = isUndoingMove ? null : createMoveUndoEntry(input)

    const result = await getWindowElectron().moveExplorerItem(input)

    if (!result.success) {
      toast.show(result)
      return false
    }

    if (input.targetParentFolderId) {
      folderExplorerEditorStore.trigger.expandedEnsured({ id: input.targetParentFolderId })
      persistUiState()
    }

    await loadItems()

    if (undoEntry) {
      pushMoveUndoEntry(undoEntry)
      showMoveUndoToast()
    }

    return true
  }
}

function createMoveUndoEntry(input: Extract<MoveExplorerItemInput, { itemType: 'folder' | 'request' }>): MoveUndoEntry | null {
  const items = folderExplorerTreeStore.getSnapshot().context.items
  const item = items.find(currentItem => currentItem.itemType === input.itemType && currentItem.id === input.id)

  if (!item || item.itemType === 'example') {
    return null
  }

  const siblings = getMovableSiblings(items, item.parentFolderId)
  const targetPosition = siblings.findIndex(sibling => sibling.itemType === item.itemType && sibling.id === item.id)

  if (targetPosition < 0) {
    return null
  }

  return {
    itemType: input.itemType,
    id: input.id,
    name: item.name,
    targetParentFolderId: item.parentFolderId,
    targetPosition,
  }
}

function getMovableSiblings(items: ExplorerItem[], parentFolderId: string | null) {
  return items
    .filter(
      (item): item is Extract<ExplorerItem, { itemType: 'folder' | 'request' }> =>
        item.itemType !== 'example' && item.parentFolderId === parentFolderId
    )
    .slice()
    .sort((left, right) => left.position - right.position || left.createdAt - right.createdAt)
}

function pushMoveUndoEntry(entry: MoveUndoEntry) {
  moveUndoStack.push(entry)
  if (moveUndoStack.length > MAX_MOVE_UNDO_STACK_SIZE) {
    moveUndoStack.splice(0, moveUndoStack.length - MAX_MOVE_UNDO_STACK_SIZE)
  }
}

function showMoveUndoToast() {
  if (moveUndoStack.length === 0) {
    toast.hide(MOVE_UNDO_TOAST_ID)
    return
  }

  const latestEntry = moveUndoStack[moveUndoStack.length - 1]
  const pendingCount = moveUndoStack.length
  const title = pendingCount === 1 ? 'Item moved' : `${pendingCount} moves available to undo`
  const label = latestEntry.itemType === 'folder' ? 'Folder' : 'Request'
  const summary = `${label} \"${latestEntry.name}\" moved.`

  toast.show({
    id: MOVE_UNDO_TOAST_ID,
    severity: 'info',
    title,
    timeout: MOVE_UNDO_TIMEOUT_MS,
    message: createElement(
      'div',
      { className: 'flex items-center gap-3' },
      createElement('span', { className: 'min-w-0 flex-1' }, pendingCount === 1 ? summary : `${summary} ${pendingCount - 1} more in stack.`),
      createElement(
        'button',
        {
          type: 'button',
          className: 'btn btn-xs',
          onClick: () => {
            void undoLastMove()
          },
        },
        'Undo'
      )
    ),
  })
}

async function undoLastMove() {
  if (isUndoingMove) {
    return
  }

  const undoEntry = moveUndoStack.pop()
  if (!undoEntry) {
    toast.hide(MOVE_UNDO_TOAST_ID)
    return
  }

  toast.hide(MOVE_UNDO_TOAST_ID)
  isUndoingMove = true

  const result = await getWindowElectron().moveExplorerItem({
    itemType: undoEntry.itemType,
    id: undoEntry.id,
    targetParentFolderId: undoEntry.targetParentFolderId,
    targetPosition: undoEntry.targetPosition,
  })

  isUndoingMove = false

  if (!result.success) {
    toast.show(result)
    showMoveUndoToast()
    return
  }

  if (undoEntry.targetParentFolderId) {
    folderExplorerEditorStore.trigger.expandedEnsured({ id: undoEntry.targetParentFolderId })
    persistUiState()
  }

  await FolderExplorerCoordinator.loadItems()
  showMoveUndoToast()
}

async function loadItem(selection: Selection) {
  const key = toSelectionKey(selection)
  const token = (loadTokens[key] ?? 0) + 1
  loadTokens[key] = token
  folderExplorerEditorStore.trigger.entryLoadingStarted({ key })

  const result =
    selection.itemType === 'folder'
      ? await getWindowElectron().getFolder({ id: selection.id })
      : selection.itemType === 'request'
        ? await getWindowElectron().getRequest({ id: selection.id })
        : await getWindowElectron().getRequestExample({ id: selection.id })

  if (loadTokens[key] !== token) return

  if (!result.success) {
    folderExplorerEditorStore.trigger.entryLoadFailed({ key, error: errorResponseToMessage(result.error) })
    toast.show(result)
    return
  }

  const serverDraft = toServerDraft(selection, result.data as FolderRecord | HttpRequestRecord | RequestExampleRecord)
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
          headers: draft.headers,
          auth: draft.auth,
          preRequestScript: draft.preRequestScript,
          postRequestScript: draft.postRequestScript,
        })
      : draft.itemType === 'request'
        ? await getWindowElectron().updateRequest({
          id: selection.id,
          name: draft.name,
          method: draft.method,
          url: draft.url,
          pathParams: draft.pathParams,
          searchParams: draft.searchParams,
          auth: draft.auth,
          preRequestScript: draft.preRequestScript,
          postRequestScript: draft.postRequestScript,
          headers: draft.headers,
          body: draft.body,
          bodyType: draft.bodyType,
          rawType: draft.rawType,
        })
        : await getWindowElectron().updateRequestExample({
            id: selection.id,
            name: draft.name,
            requestHeaders: draft.requestHeaders,
            requestBody: draft.requestBody,
            requestBodyType: draft.requestBodyType,
            requestRawType: draft.requestRawType,
            responseStatus: draft.responseStatus,
            responseStatusText: draft.responseStatusText,
            responseHeaders: draft.responseHeaders,
            responseBody: draft.responseBody,
          })

  if (saveTokens[key] !== token) return

  if (!result.success) {
    folderExplorerEditorStore.trigger.entrySaveFailed({ key, error: errorResponseToMessage(result.error) })
    toast.show(result)
    return
  }

  const serverDraft = toServerDraft(selection, result.data as FolderRecord | HttpRequestRecord | RequestExampleRecord)
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

function persistUiState() {
  const { selected, expandedIds } = folderExplorerEditorStore.getSnapshot().context
  saveFolderExplorerUiState(selected, expandedIds)
}

function isSameSelection(left: Selection | null, right: Selection | null) {
  if (!left || !right) return left === right
  return left.id === right.id && left.itemType === right.itemType
}

function toServerDraft(selection: Selection, value: FolderRecord | HttpRequestRecord | RequestExampleRecord) {
  return selection.itemType === 'folder'
    ? toFolderDetailsDraft(value as FolderRecord)
    : selection.itemType === 'request'
      ? toRequestDetailsDraft(value as HttpRequestRecord)
      : toRequestExampleDetailsDraft(value as RequestExampleRecord)
}
