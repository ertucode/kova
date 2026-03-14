import { createStore } from '@xstate/store'
import { z } from 'zod'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import type { ExplorerItem } from '@common/Explorer'
import type { DetailsDraft, Selection } from './folderExplorerTypes'
import { serializeDetails, toSelectionKey } from './folderExplorerUtils'
import { loadFromAsyncStorage } from '@/utils/asyncStorage'
import {
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
} from './folderExplorerTypes'

const PERSISTED_UI_STATE_KEY = 'folderExplorer:uiState'

export type SidebarTab = 'requests' | 'environments' | 'history'

const selectionSchema = z.object({
  itemType: z.union([z.literal('folder'), z.literal('request')]),
  id: z.string(),
})

const persistedUiStateSchema = z.object({
  selected: selectionSchema.nullable(),
  expandedIds: z.array(z.string()),
  activeEnvironmentIds: z.array(z.string()),
  sidebarTab: z.union([z.literal('requests'), z.literal('environments'), z.literal('history'), z.literal('console')]),
})

const folderDetailsDraftSchema = z.object({
  itemType: z.literal('folder'),
  name: z.string(),
  description: z.string(),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
})

const requestDetailsDraftSchema = z.object({
  itemType: z.literal('request'),
  name: z.string(),
  method: z.enum(REQUEST_METHODS),
  url: z.string(),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
  headers: z.string(),
  body: z.string(),
  bodyType: z.enum(REQUEST_BODY_TYPES),
  rawType: z.enum(REQUEST_RAW_TYPES),
})

export const persistedDraftsSchema = z.record(
  z.string(),
  z.discriminatedUnion('itemType', [folderDetailsDraftSchema, requestDetailsDraftSchema])
)

export type EditorEntry = {
  base: DetailsDraft | null
  current: DetailsDraft | null
  loading: boolean
  saving: boolean
  error: string | null
  version: number
}

type FolderExplorerEditorContext = {
  selected: Selection | null
  expandedIds: string[]
  activeEnvironmentIds: string[]
  sidebarTab: SidebarTab
  entries: Record<string, EditorEntry>
}

const persistedUiState = loadFolderExplorerUiState()

const persistedDrafts = loadFromAsyncStorage(AsyncStorageKeys.folderExplorerDrafts, persistedDraftsSchema, {})

const initialEntries = Object.fromEntries(
  Object.entries(persistedDrafts).map(([key, draft]) => [
    key,
    {
      base: null,
      current: draft,
      loading: false,
      saving: false,
      error: null,
      version: 1,
    } satisfies EditorEntry,
  ])
)

export const folderExplorerEditorStore = createStore({
  context: {
    selected: persistedUiState.selected,
    expandedIds: persistedUiState.expandedIds,
    activeEnvironmentIds: persistedUiState.activeEnvironmentIds,
    sidebarTab: persistedUiState.sidebarTab,
    entries: initialEntries,
  } as FolderExplorerEditorContext,
  on: {
    selectionChanged: (context, event: { selection: Selection | null }) => ({
      ...context,
      selected: event.selection,
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
    expandedIdsReconciled: (context, event: { items: ExplorerItem[] }) => ({
      ...context,
      expandedIds: getNextExpandedIds(context.expandedIds, event.items),
    }),
    sidebarTabChanged: (context, event: { sidebarTab: SidebarTab }) => ({
      ...context,
      sidebarTab: event.sidebarTab,
    }),
    activeEnvironmentToggled: (context, event: { id: string }) => ({
      ...context,
      activeEnvironmentIds: context.activeEnvironmentIds.includes(event.id)
        ? context.activeEnvironmentIds.filter(value => value !== event.id)
        : [...context.activeEnvironmentIds, event.id],
    }),
    activeEnvironmentIdsReconciled: (context, event: { ids: string[] }) => ({
      ...context,
      activeEnvironmentIds: context.activeEnvironmentIds.filter(id => event.ids.includes(id)),
    }),
    entryLoadingStarted: (context, event: { key: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          loading: true,
          error: null,
        },
      },
    }),
    entryLoaded: (context, event: { key: string; base: DetailsDraft; current: DetailsDraft }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          base: event.base,
          current: event.current,
          loading: false,
          error: null,
        },
      },
    }),
    entryLoadFailed: (context, event: { key: string; error: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          loading: false,
          error: event.error,
        },
      },
    }),
    selectedDraftUpdated: (context, event: { draft: DetailsDraft }) => {
      if (!context.selected) {
        return context
      }

      const key = toSelectionKey(context.selected)
      const entry = context.entries[key] ?? createEmptyEntry()

      return {
        ...context,
        entries: {
          ...context.entries,
          [key]: {
            ...entry,
            current: event.draft,
            error: null,
            version: entry.version + 1,
          },
        },
      }
    },
    entrySavingStarted: (context, event: { key: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          saving: true,
          error: null,
        },
      },
    }),
    entrySaved: (context, event: { key: string; base: DetailsDraft; current: DetailsDraft }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          base: event.base,
          current: event.current,
          saving: false,
          error: null,
        },
      },
    }),
    entrySaveFailed: (context, event: { key: string; error: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.key]: {
          ...(context.entries[event.key] ?? createEmptyEntry()),
          saving: false,
          error: event.error,
        },
      },
    }),
    itemStatesCleared: (context, event: { keys: string[] }) => {
      const nextEntries = { ...context.entries }
      event.keys.forEach(key => {
        delete nextEntries[key]
      })

      const shouldClearSelected = context.selected ? event.keys.includes(toSelectionKey(context.selected)) : false
      return {
        ...context,
        entries: nextEntries,
        selected: shouldClearSelected ? null : context.selected,
      }
    },
  },
})

export function createEmptyEntry(): EditorEntry {
  return {
    base: null,
    current: null,
    loading: false,
    saving: false,
    error: null,
    version: 0,
  }
}

export function isEntryDirty(entry: EditorEntry) {
  if (!entry.current) return false
  if (!entry.base) return true
  return serializeDetails(entry.current) !== serializeDetails(entry.base)
}

export function getSelectedEntry() {
  const state = folderExplorerEditorStore.getSnapshot().context
  if (!state.selected) return null
  return state.entries[toSelectionKey(state.selected)] ?? createEmptyEntry()
}

export function saveFolderExplorerUiState(selection: Selection | null, expandedIds: string[]) {
  const { activeEnvironmentIds, sidebarTab } = folderExplorerEditorStore.getSnapshot().context
  try {
    localStorage.setItem(
      PERSISTED_UI_STATE_KEY,
      JSON.stringify({ selected: selection, expandedIds, activeEnvironmentIds, sidebarTab })
    )
  } catch {
    return
  }
}

function loadFolderExplorerUiState(): {
  selected: Selection | null
  expandedIds: string[]
  activeEnvironmentIds: string[]
  sidebarTab: SidebarTab
} {
  try {
    const value = localStorage.getItem(PERSISTED_UI_STATE_KEY)
    if (!value) return { selected: null, expandedIds: [], activeEnvironmentIds: [], sidebarTab: 'requests' }
    const parsed = persistedUiStateSchema.safeParse(JSON.parse(value))
    if (!parsed.success) {
      return { selected: null, expandedIds: [], activeEnvironmentIds: [], sidebarTab: 'requests' }
    }

    return {
      ...parsed.data,
      sidebarTab: parsed.data.sidebarTab === 'console' ? 'history' : parsed.data.sidebarTab,
    }
  } catch {
    return { selected: null, expandedIds: [], activeEnvironmentIds: [], sidebarTab: 'requests' }
  }
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
