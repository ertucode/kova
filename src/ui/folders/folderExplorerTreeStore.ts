import { createStore } from '@xstate/store'
import type { ExplorerItem } from '@common/Explorer'
import type { CreateDraft, Selection } from './folderExplorerTypes'
import { toSelectionKey } from './folderExplorerUtils'

export type FolderExplorerTreeContext = {
  items: ExplorerItem[]
  expandedIds: string[]
  searchQuery: string
  createDraft: CreateDraft | null
  isLoading: boolean
}

export const folderExplorerTreeStore = createStore({
  context: {
    items: [],
    expandedIds: [],
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
      expandedIds: getNextExpandedIds(context.expandedIds, event.items),
      isLoading: false,
    }),
    searchQueryChanged: (context, event: { searchQuery: string }) => ({
      ...context,
      searchQuery: event.searchQuery,
    }),
    expandedToggled: (context, event: { id: string }) => ({
      ...context,
      expandedIds: context.expandedIds.includes(event.id)
        ? context.expandedIds.filter(value => value !== event.id)
        : [...context.expandedIds, event.id],
    }),
    expandedEnsured: (context, event: { id: string }) => ({
      ...context,
      expandedIds: context.expandedIds.includes(event.id) ? context.expandedIds : [...context.expandedIds, event.id],
    }),
    createStarted: (context, event: { itemType: ExplorerItem['itemType']; parentFolderId: string | null }) => ({
      ...context,
      createDraft: { itemType: event.itemType, parentFolderId: event.parentFolderId, name: '' },
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
        : currentItem.parentFolderId !== null && descendantFolderIds.has(currentItem.parentFolderId)
    )
    .map(currentItem => toSelectionKey(currentItem))
}

function getNextExpandedIds(previousExpandedIds: string[], items: ExplorerItem[]) {
  const validFolderIds = new Set(items.filter(item => item.itemType === 'folder').map(item => item.id))
  const nextExpandedIds = previousExpandedIds.filter(id => validFolderIds.has(id))

  if (nextExpandedIds.length > 0) {
    return nextExpandedIds
  }

  return items
    .filter(item => item.itemType === 'folder' && item.parentFolderId === null)
    .map(item => item.id)
}
