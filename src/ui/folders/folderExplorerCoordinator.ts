import { createElement } from 'react'
import type { FolderExplorerTabRecord } from '@common/FolderExplorerTabs'
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
  getSelectionFromTabs,
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
const MAX_FOLDER_EXPLORER_TABS = 20

type OpenTabMode = 'preview' | 'pin'

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
  export async function initialize() {
    await loadItems()
    await loadTabs()
  }

  export async function loadItems() {
    folderExplorerTreeStore.trigger.loadingStarted()

    try {
      const items = await getWindowElectron().listExplorerItems()
      folderExplorerTreeStore.trigger.itemsLoaded({ items })
      folderExplorerEditorStore.trigger.expandedIdsReconciled({ items })
      await reconcileTabsWithItems(items)
      persistUiState()
    } catch (error) {
      folderExplorerTreeStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load explorer items',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function loadTabs() {
    const tabs = await getWindowElectron().listFolderExplorerTabs()
    await replaceTabsState(tabs, getActiveTabIdFromTabs(tabs), { persist: false, loadActiveSelection: true, reconcile: true })
  }

  export async function selectItem(selection: Selection | null, options?: { mode?: OpenTabMode }) {
    if (!selection) {
      await replaceTabsState([], null)
      return
    }

    const mode = options?.mode ?? 'pin'
    const state = folderExplorerEditorStore.getSnapshot().context

    const existingTab = state.tabs.find(tab => tab.itemType === selection.itemType && tab.itemId === selection.id)
    if (existingTab) {
      const nextTabs = state.tabs.map(tab =>
        tab.id === existingTab.id && mode === 'pin' && !tab.isPinned
          ? { ...tab, isPinned: true, updatedAt: Date.now() }
          : tab
      )
      await replaceTabsState(nextTabs, existingTab.id)
      return
    }

    const now = Date.now()
    const previewTab = mode === 'preview' ? state.tabs.find(tab => !tab.isPinned) : null
    const nextTabsBase = previewTab
      ? state.tabs.map(tab =>
          tab.id === previewTab.id
            ? {
                ...tab,
                itemType: selection.itemType,
                itemId: selection.id,
                isPinned: false,
                updatedAt: now,
              }
            : tab
        )
      : [
          ...state.tabs,
          {
            id: crypto.randomUUID(),
            itemType: selection.itemType,
            itemId: selection.id,
            position: state.tabs.length,
            isPinned: mode === 'pin',
            isActive: false,
            createdAt: now,
            updatedAt: now,
          } satisfies FolderExplorerTabRecord,
        ]
    const nextActiveTabId = previewTab ? previewTab.id : nextTabsBase[nextTabsBase.length - 1]?.id ?? null
    const nextTabs = enforceTabLimit(nextTabsBase, nextActiveTabId)
    await replaceTabsState(nextTabs, getValidActiveTabId(nextTabs, nextActiveTabId))
  }

  export async function closeTab(tabId: string) {
    const { tabs, activeTabId } = folderExplorerEditorStore.getSnapshot().context
    const tabIndex = tabs.findIndex(tab => tab.id === tabId)
    if (tabIndex < 0) {
      return
    }

    const nextTabs = tabs.filter(tab => tab.id !== tabId)
    const nextActiveTabId =
      activeTabId === tabId ? nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[tabIndex]?.id ?? null : activeTabId

    await replaceTabsState(nextTabs, getValidActiveTabId(nextTabs, nextActiveTabId))
  }

  export async function activateTab(tabId: string) {
    const { tabs } = folderExplorerEditorStore.getSnapshot().context
    if (!tabs.some(tab => tab.id === tabId)) {
      return
    }

    await replaceTabsState(tabs, tabId)
  }

  export async function pinTab(tabId: string) {
    const { tabs, activeTabId } = folderExplorerEditorStore.getSnapshot().context
    const nextTabs = tabs.map(tab => (tab.id === tabId && !tab.isPinned ? { ...tab, isPinned: true, updatedAt: Date.now() } : tab))
    await replaceTabsState(nextTabs, activeTabId ?? tabId)
  }

  export async function moveTab(tabId: string, targetPosition: number) {
    const { tabs, activeTabId } = folderExplorerEditorStore.getSnapshot().context
    const currentIndex = tabs.findIndex(tab => tab.id === tabId)
    if (currentIndex < 0) {
      return
    }

    const [tab] = tabs.slice(currentIndex, currentIndex + 1)
    const remainingTabs = tabs.filter(currentTab => currentTab.id !== tabId)
    const adjustedTargetPosition = targetPosition > currentIndex ? targetPosition - 1 : targetPosition
    const nextPosition = Math.max(0, Math.min(adjustedTargetPosition, remainingTabs.length))
    const nextTabs = remainingTabs.slice()
    nextTabs.splice(nextPosition, 0, tab)
    await replaceTabsState(nextTabs, activeTabId)
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
    await selectItem({ itemType: 'request', id: result.data.id })
    toast.show({ severity: 'success', title: 'Request duplicated', message: `Created ${result.data.name}.` })
  }

  export function startCreate(itemType: Extract<ExplorerItem['itemType'], 'folder' | 'request'>, parentFolderId: string | null) {
    folderExplorerTreeStore.trigger.createStarted({ itemType, parentFolderId })
    if (parentFolderId) {
      folderExplorerEditorStore.trigger.expandedEnsured({ id: parentFolderId })
      persistUiState()
      void selectItem({ itemType: 'folder', id: parentFolderId })
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
    await selectItem({ itemType: createDraft.itemType, id: result.data.id })
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

async function reconcileTabsWithItems(items: ExplorerItem[]) {
  const { tabs, activeTabId } = folderExplorerEditorStore.getSnapshot().context
  if (tabs.length === 0) {
    if (folderExplorerEditorStore.getSnapshot().context.selected !== null) {
      folderExplorerEditorStore.trigger.tabsStateReplaced({ tabs: [], activeTabId: null })
    }
    return
  }

  const validTabs = tabs.filter(tab => items.some(item => item.itemType === tab.itemType && item.id === tab.itemId))
  const nextActiveTabId = getValidActiveTabId(validTabs, activeTabId)
  const hasChanged =
    validTabs.length !== tabs.length ||
    validTabs.some((tab, index) => tab.id !== tabs[index]?.id) ||
    nextActiveTabId !== activeTabId

  if (!hasChanged) {
    return
  }

  await replaceTabsState(validTabs, nextActiveTabId, { loadActiveSelection: false })
}

function getActiveTabIdFromTabs(tabs: FolderExplorerTabRecord[]) {
  return tabs.find(tab => tab.isActive)?.id ?? tabs[0]?.id ?? null
}

function getValidActiveTabId(tabs: FolderExplorerTabRecord[], activeTabId: string | null) {
  if (activeTabId && tabs.some(tab => tab.id === activeTabId)) {
    return activeTabId
  }

  return tabs[0]?.id ?? null
}

function enforceTabLimit(tabs: FolderExplorerTabRecord[], activeTabId: string | null) {
  if (tabs.length <= MAX_FOLDER_EXPLORER_TABS) {
    return tabs
  }

  const removableTabs = tabs.filter(tab => tab.id !== activeTabId)
  const firstPreviewTab = removableTabs.find(tab => !tab.isPinned)
  const tabIdToRemove = firstPreviewTab?.id ?? removableTabs[0]?.id

  if (!tabIdToRemove) {
    return tabs.slice(-MAX_FOLDER_EXPLORER_TABS)
  }

  return enforceTabLimit(
    tabs.filter(tab => tab.id !== tabIdToRemove),
    activeTabId
  )
}

async function replaceTabsState(
  tabs: FolderExplorerTabRecord[],
  activeTabId: string | null,
  options?: { persist?: boolean; loadActiveSelection?: boolean; reconcile?: boolean }
) {
  const persist = options?.persist ?? true
  const loadActiveSelection = options?.loadActiveSelection ?? true
  const nextTabs = normalizeTabs(options?.reconcile ? filterToExistingTabs(tabs) : tabs, activeTabId)
  const nextActiveTabId = getValidActiveTabId(nextTabs, activeTabId)

  folderExplorerEditorStore.trigger.tabsStateReplaced({ tabs: nextTabs, activeTabId: nextActiveTabId })
  persistUiState()

  if (persist) {
    await persistTabsState(nextTabs, nextActiveTabId)
  }

  const nextSelection = getSelectionFromTabs(nextTabs, nextActiveTabId)
  if (loadActiveSelection && nextSelection) {
    await ensureItemLoaded(nextSelection)
  }
}

function filterToExistingTabs(tabs: FolderExplorerTabRecord[]) {
  const items = folderExplorerTreeStore.getSnapshot().context.items
  return tabs.filter(tab => items.some(item => item.itemType === tab.itemType && item.id === tab.itemId))
}

function normalizeTabs(tabs: FolderExplorerTabRecord[], activeTabId: string | null) {
  const nextActiveTabId = getValidActiveTabId(tabs, activeTabId)
  return tabs.map((tab, index) => ({
    ...tab,
    position: index,
    isActive: tab.id === nextActiveTabId,
  }))
}

async function persistTabsState(tabs: FolderExplorerTabRecord[], activeTabId: string | null) {
  const normalizedTabs = normalizeTabs(tabs, activeTabId)
  const result = await getWindowElectron().saveFolderExplorerTabs({ tabs: normalizedTabs })
  if (!result.success) {
    toast.show(result)
  }
}

async function ensureItemLoaded(selection: Selection) {
  const { entries } = folderExplorerEditorStore.getSnapshot().context
  const entry = entries[toSelectionKey(selection)]
  if (!entry?.base) {
    await loadItem(selection)
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

function toServerDraft(selection: Selection, value: FolderRecord | HttpRequestRecord | RequestExampleRecord) {
  return selection.itemType === 'folder'
    ? toFolderDetailsDraft(value as FolderRecord)
    : selection.itemType === 'request'
      ? toRequestDetailsDraft(value as HttpRequestRecord)
      : toRequestExampleDetailsDraft(value as RequestExampleRecord)
}
