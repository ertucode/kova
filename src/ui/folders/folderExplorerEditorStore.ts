import { createStore } from '@xstate/store'
import { z } from 'zod'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import type { DetailsDraft, Selection } from './folderExplorerTypes'
import { serializeDetails, toSelectionKey } from './folderExplorerUtils'
import { loadFromAsyncStorage } from '@/utils/asyncStorage'
import {
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
} from './folderExplorerTypes'

const LAST_SELECTED_TREE_ITEM_KEY = 'folderExplorer:lastSelectedTreeItem'

const selectionSchema = z.object({
  itemType: z.union([z.literal('folder'), z.literal('request')]),
  id: z.string(),
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
  entries: Record<string, EditorEntry>
}

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
    selected: loadLastSelectedTreeItem(),
    entries: initialEntries,
  } as FolderExplorerEditorContext,
  on: {
    selectionChanged: (context, event: { selection: Selection | null }) => ({
      ...context,
      selected: event.selection,
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

function loadLastSelectedTreeItem(): Selection | null {
  try {
    const value = localStorage.getItem(LAST_SELECTED_TREE_ITEM_KEY)
    if (!value) return null
    const parsed = selectionSchema.safeParse(JSON.parse(value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveLastSelectedTreeItem(selection: Selection | null) {
  try {
    if (!selection) {
      localStorage.removeItem(LAST_SELECTED_TREE_ITEM_KEY)
      return
    }

    localStorage.setItem(LAST_SELECTED_TREE_ITEM_KEY, JSON.stringify(selection))
  } catch {
    return
  }
}
