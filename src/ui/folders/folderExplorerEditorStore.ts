import { createStore } from '@xstate/store'
import { z } from 'zod'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import { AUTH_LOCATIONS } from '@common/Auth'
import type { FolderExplorerTabRecord } from '@common/FolderExplorerTabs'
import type { ExplorerItem } from '@common/Explorer'
import type { DetailsDraft, Selection } from './folderExplorerTypes'
import { serializeDetails, toSelectionKey } from './folderExplorerUtils'
import { loadFromAsyncStorage } from '@/utils/asyncStorage'
import {
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
} from './folderExplorerTypes'
import type { RequestType } from '@common/Requests'

const REQUEST_TYPES: RequestType[] = ['http', 'websocket']
const RESPONSE_BODY_VIEWS = ['raw', 'table', 'visualizer'] as const

const PERSISTED_UI_STATE_KEY = 'folderExplorer:uiState'
const DEFAULT_RESPONSE_PANE_HEIGHT = 320

export type SidebarTab = 'requests' | 'environments' | 'history' | 'changes'

const selectionSchema = z.object({
  itemType: z.union([z.literal('folder'), z.literal('request'), z.literal('example')]),
  id: z.string(),
})

const persistedUiStateSchema = z.object({
  selected: selectionSchema.nullable(),
  expandedIds: z.array(z.string()),
  activeEnvironmentIds: z.array(z.string()),
  sidebarTab: z.union([
    z.literal('requests'),
    z.literal('environments'),
    z.literal('history'),
    z.literal('changes'),
    z.literal('console'),
  ]),
  responsePaneHeight: z.number(),
})

const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('noauth') }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({ type: z.literal('apikey'), key: z.string(), value: z.string(), addTo: z.enum(AUTH_LOCATIONS) }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
])

const folderDetailsDraftSchema = z.object({
  itemType: z.literal('folder'),
  name: z.string(),
  description: z.string(),
  headers: z.string().default(''),
  auth: authSchema.default({ type: 'inherit' }),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
})

const requestDetailsDraftSchema = z.object({
  itemType: z.literal('request'),
  name: z.string(),
  requestType: z.enum(REQUEST_TYPES),
  method: z.enum(REQUEST_METHODS),
  url: z.string(),
  pathParams: z.string().default(''),
  searchParams: z.string().default(''),
  auth: authSchema.default({ type: 'inherit' }),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
  responseVisualizer: z.string().default(''),
  responseTableAccessor: z.string().default(''),
  preferredResponseBodyView: z.enum(RESPONSE_BODY_VIEWS).default('raw'),
  headers: z.string(),
  body: z.string(),
  bodyType: z.enum(REQUEST_BODY_TYPES),
  rawType: z.enum(REQUEST_RAW_TYPES),
  websocketSubprotocols: z.string().default(''),
  websocketOnOpenMessage: z.string().default(''),
  websocketAutoSendEnabled: z.boolean().default(false),
  websocketAutoSendMessage: z.string().default(''),
  websocketAutoSendIntervalSeconds: z.number().int().min(0).default(0),
  saveToHistory: z.boolean().default(true),
})

const requestExampleDetailsDraftSchema = z.object({
  itemType: z.literal('example'),
  exampleType: z.literal('http'),
  name: z.string(),
  requestHeaders: z.string(),
  requestBody: z.string(),
  requestBodyType: z.enum(REQUEST_BODY_TYPES),
  requestRawType: z.enum(REQUEST_RAW_TYPES),
  responseStatus: z.number(),
  responseStatusText: z.string(),
  responseHeaders: z.string(),
  responseBody: z.string(),
})

const websocketExampleDetailsDraftSchema = z.object({
  itemType: z.literal('example'),
  exampleType: z.literal('websocket'),
  name: z.string(),
  requestHeaders: z.string(),
  requestBody: z.string(),
  messages: z.array(z.object({
    id: z.string(),
    exampleId: z.string(),
    direction: z.union([z.literal('sent'), z.literal('received')]),
    body: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.number(),
    timestamp: z.number(),
    createdAt: z.number(),
  })),
})

export const persistedDraftsSchema = z.record(
  z.string(),
  z.union([folderDetailsDraftSchema, requestDetailsDraftSchema, requestExampleDetailsDraftSchema, websocketExampleDetailsDraftSchema])
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
  tabs: FolderExplorerTabRecord[]
  activeTabId: string | null
  expandedIds: string[]
  activeEnvironmentIds: string[]
  sidebarTab: SidebarTab
  responsePaneHeight: number
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
    tabs: [],
    activeTabId: null,
    expandedIds: persistedUiState.expandedIds,
    activeEnvironmentIds: persistedUiState.activeEnvironmentIds,
    sidebarTab: persistedUiState.sidebarTab,
    responsePaneHeight: persistedUiState.responsePaneHeight,
    entries: initialEntries,
  } as FolderExplorerEditorContext,
  on: {
    selectionChanged: (context, event: { selection: Selection | null }) => ({
      ...context,
      selected: event.selection,
    }),
    tabsStateReplaced: (context, event: { tabs: FolderExplorerTabRecord[]; activeTabId: string | null }) => ({
      ...context,
      tabs: event.tabs,
      activeTabId: event.activeTabId,
      selected: getSelectionFromTabs(event.tabs, event.activeTabId),
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
    responsePaneHeightChanged: (context, event: { height: number }) => ({
      ...context,
      responsePaneHeight: event.height,
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
    entryDraftUpdated: (context, event: { key: string; draft: DetailsDraft }) => {
      const entry = context.entries[event.key] ?? createEmptyEntry()

      return {
        ...context,
        entries: {
          ...context.entries,
          [event.key]: {
            ...entry,
            current: event.draft,
            error: null,
            version: entry.version + 1,
          },
        },
      }
    },
    entryResetToBase: (context, event: { key: string }) => {
      const entry = context.entries[event.key] ?? createEmptyEntry()
      if (!entry.base) {
        return context
      }

      return {
        ...context,
        entries: {
          ...context.entries,
          [event.key]: {
            ...entry,
            current: entry.base,
            saving: false,
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

export function getSelectionFromTabs(tabs: FolderExplorerTabRecord[], activeTabId: string | null): Selection | null {
  if (!activeTabId) {
    return null
  }

  const activeTab = tabs.find(tab => tab.id === activeTabId)
  if (!activeTab) {
    return null
  }

  return {
    itemType: activeTab.itemType,
    id: activeTab.itemId,
  }
}

export function saveFolderExplorerUiState(selection: Selection | null, expandedIds: string[]) {
  const { activeEnvironmentIds, sidebarTab, responsePaneHeight } = folderExplorerEditorStore.getSnapshot().context
  try {
    localStorage.setItem(
      PERSISTED_UI_STATE_KEY,
      JSON.stringify({ selected: selection, expandedIds, activeEnvironmentIds, sidebarTab, responsePaneHeight })
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
  responsePaneHeight: number
} {
  try {
    const value = localStorage.getItem(PERSISTED_UI_STATE_KEY)
    if (!value) {
      return {
        selected: null,
        expandedIds: [],
        activeEnvironmentIds: [],
        sidebarTab: 'requests',
        responsePaneHeight: DEFAULT_RESPONSE_PANE_HEIGHT,
      }
    }
    const parsed = persistedUiStateSchema.safeParse(JSON.parse(value))
    if (!parsed.success) {
      return {
        selected: null,
        expandedIds: [],
        activeEnvironmentIds: [],
        sidebarTab: 'requests',
        responsePaneHeight: DEFAULT_RESPONSE_PANE_HEIGHT,
      }
    }

    return {
      ...parsed.data,
      sidebarTab: parsed.data.sidebarTab === 'console' ? 'history' : parsed.data.sidebarTab,
    }
  } catch {
    return {
      selected: null,
      expandedIds: [],
      activeEnvironmentIds: [],
      sidebarTab: 'requests',
      responsePaneHeight: DEFAULT_RESPONSE_PANE_HEIGHT,
    }
  }
}

function getNextExpandedIds(previousExpandedIds: string[], items: ExplorerItem[]) {
  const expandableItemIds = new Set(
    items
      .filter(item => item.itemType === 'folder' || item.itemType === 'request')
      .map(item => item.id)
  )
  return previousExpandedIds.filter(id => expandableItemIds.has(id))
}
