import { createStore } from '@xstate/store'
import type { ExplorerItem } from '@common/Explorer'
import type { RequestType } from '@common/Requests'
import type { CreateDraft, Selection } from './folderExplorerTypes'
import { toSelectionKey } from './folderExplorerUtils'

export type FolderExplorerTreeContext = {
  items: ExplorerItem[]
  searchQuery: string
  createDraft: CreateDraft | null
  isLoading: boolean
}

export const folderExplorerTreeStore = createStore({
  context: {
    items: [],
    searchQuery: '',
    createDraft: null,
    isLoading: false,
  } as FolderExplorerTreeContext,
  on: {
    loadingStarted: context => ({
      ...context,
      isLoading: true,
    }),
    loadingFinished: context => ({
      ...context,
      isLoading: false,
    }),
    itemsLoaded: (context, event: { items: ExplorerItem[] }) => ({
      ...context,
      items: event.items,
      isLoading: false,
    }),
    searchQueryChanged: (context, event: { searchQuery: string }) => ({
      ...context,
      searchQuery: event.searchQuery,
    }),
    createStarted: (context, event: { itemType: ExplorerItem['itemType']; parentFolderId: string | null; requestType?: RequestType }) => ({
      ...context,
      createDraft: { itemType: event.itemType, parentFolderId: event.parentFolderId, name: '', requestType: event.requestType },
    }),
    createNameChanged: (context, event: { name: string }) => ({
      ...context,
      createDraft: context.createDraft
        ? {
            ...context.createDraft,
            name: event.name,
          }
        : null,
    }),
    createCancelled: context => ({
      ...context,
      createDraft: null,
    }),
    itemNameUpdated: (context, event: { selection: Selection; name: string }) => ({
      ...context,
      items: context.items.map(item =>
        item.id === event.selection.id && item.itemType === event.selection.itemType ? { ...item, name: event.name } : item
      ),
    }),
  },
})

export function getDeletedItemKeys(items: ExplorerItem[], item: ExplorerItem) {
  if (item.itemType === 'request') {
    return items.filter(currentItem => (currentItem.itemType === 'example' ? currentItem.requestId === item.id : currentItem.id === item.id && currentItem.itemType === 'request')).map(toSelectionKey)
      .concat(toSelectionKey(item))
      .filter((value, index, array) => array.indexOf(value) === index)
  }

  if (item.itemType === 'example') {
    return [toSelectionKey(item)]
  }

  const descendantFolderIds = new Set<string>([item.id])
  let changed = true

  while (changed) {
    changed = false
    items.forEach(currentItem => {
      if (
        currentItem.itemType === 'folder' &&
        currentItem.parentFolderId &&
        descendantFolderIds.has(currentItem.parentFolderId) &&
        !descendantFolderIds.has(currentItem.id)
      ) {
        descendantFolderIds.add(currentItem.id)
        changed = true
      }
    })
  }

  return items
    .filter(currentItem =>
      currentItem.itemType === 'folder'
        ? descendantFolderIds.has(currentItem.id)
        : currentItem.itemType === 'request'
          ? currentItem.parentFolderId !== null && descendantFolderIds.has(currentItem.parentFolderId)
          : items.some(request => request.itemType === 'request' && request.id === currentItem.requestId && descendantFolderIds.has(request.parentFolderId ?? ''))
    )
    .map(currentItem => toSelectionKey(currentItem))
}
