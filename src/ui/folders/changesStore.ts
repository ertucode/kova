import { createStore } from '@xstate/store'
import type { OperationRecord, OperationStatus } from '@common/Operations'

export type ChangesStatusFilter = 'all' | OperationStatus

type ChangesContext = {
  operations: OperationRecord[]
  loading: boolean
  searchQuery: string
  statusFilter: ChangesStatusFilter
  selectedIds: string[]
}

export const changesStore = createStore({
  context: {
    operations: [],
    loading: false,
    searchQuery: '',
    statusFilter: 'all',
    selectedIds: [],
  } as ChangesContext,
  on: {
    loadingStarted: context => ({
      ...context,
      loading: true,
    }),
    operationsLoaded: (context, event: { operations: OperationRecord[] }) => ({
      ...context,
      operations: event.operations,
      loading: false,
      selectedIds: context.selectedIds.filter(id => event.operations.some(operation => operation.id === id)),
    }),
    loadingFinished: context => ({
      ...context,
      loading: false,
    }),
    searchQueryChanged: (context, event: { searchQuery: string }) => ({
      ...context,
      searchQuery: event.searchQuery,
    }),
    statusFilterChanged: (context, event: { statusFilter: ChangesStatusFilter }) => ({
      ...context,
      statusFilter: event.statusFilter,
    }),
    selectionToggled: (context, event: { id: string }) => ({
      ...context,
      selectedIds: context.selectedIds.includes(event.id)
        ? context.selectedIds.filter(id => id !== event.id)
        : [...context.selectedIds, event.id],
    }),
    visibleSelectionToggled: (context, event: { ids: string[] }) => {
      const everySelected = event.ids.length > 0 && event.ids.every(id => context.selectedIds.includes(id))
      return {
        ...context,
        selectedIds: everySelected
          ? context.selectedIds.filter(id => !event.ids.includes(id))
          : [...new Set([...context.selectedIds, ...event.ids])],
      }
    },
    selectionCleared: context => ({
      ...context,
      selectedIds: [],
    }),
  },
})
