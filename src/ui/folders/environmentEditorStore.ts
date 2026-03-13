import { createStore } from '@xstate/store'
import type { EnvironmentRecord } from '@common/Environments'

export type EnvironmentDetailsDraft = {
  name: string
  variables: string
  priority: number
}

export type EnvironmentEntry = {
  base: EnvironmentDetailsDraft | null
  current: EnvironmentDetailsDraft | null
  saving: boolean
  error: string | null
  version: number
}

type EnvironmentEditorContext = {
  items: EnvironmentRecord[]
  selectedId: string | null
  focusEnvironmentId: string | null
  loading: boolean
  entries: Record<string, EnvironmentEntry>
}

export const environmentEditorStore = createStore({
  context: {
    items: [],
    selectedId: null,
    focusEnvironmentId: null,
    loading: false,
    entries: {},
  } as EnvironmentEditorContext,
  on: {
    loadingStarted: context => ({
      ...context,
      loading: true,
    }),
    loadingFinished: context => ({
      ...context,
      loading: false,
    }),
    listLoaded: (context, event: { items: EnvironmentRecord[] }) => {
      const nextEntries = Object.fromEntries(
        event.items.map(item => {
          const base = toEnvironmentDetailsDraft(item)
          const existing = context.entries[item.id] ?? createEmptyEnvironmentEntry()
          const current = existing.current && serializeEnvironmentDraft(existing.current) !== serializeEnvironmentDraft(base)
            ? existing.current
            : base

          return [
            item.id,
            {
              ...existing,
              base,
              current,
              error: null,
            } satisfies EnvironmentEntry,
          ]
        })
      )

      return {
        ...context,
        items: event.items,
        entries: nextEntries,
        loading: false,
        selectedId: event.items.some(item => item.id === context.selectedId) ? context.selectedId : (event.items[0]?.id ?? null),
      }
    },
    selectedChanged: (context, event: { id: string | null }) => ({
      ...context,
      selectedId: event.id,
    }),
    focusHandled: context => ({
      ...context,
      focusEnvironmentId: null,
    }),
    draftUpdated: (context, event: { id: string; draft: EnvironmentDetailsDraft }) => {
      const entry = context.entries[event.id] ?? createEmptyEnvironmentEntry()

      return {
        ...context,
        entries: {
          ...context.entries,
          [event.id]: {
            ...entry,
            current: event.draft,
            error: null,
            version: entry.version + 1,
          },
        },
      }
    },
    entrySavingStarted: (context, event: { id: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.id]: {
          ...(context.entries[event.id] ?? createEmptyEnvironmentEntry()),
          saving: true,
          error: null,
        },
      },
    }),
    entrySaved: (context, event: { item: EnvironmentRecord; version: number }) => {
      const base = toEnvironmentDetailsDraft(event.item)
      const existing = context.entries[event.item.id] ?? createEmptyEnvironmentEntry()
      const nextCurrent = existing.version === event.version ? base : (existing.current ?? base)

      return {
        ...context,
        items: context.items
          .map(item => (item.id === event.item.id ? event.item : item))
          .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt),
        entries: {
          ...context.entries,
          [event.item.id]: {
            ...existing,
            base,
            current: nextCurrent,
            saving: false,
            error: null,
          },
        },
      }
    },
    entrySaveFailed: (context, event: { id: string; error: string }) => ({
      ...context,
      entries: {
        ...context.entries,
        [event.id]: {
          ...(context.entries[event.id] ?? createEmptyEnvironmentEntry()),
          saving: false,
          error: event.error,
        },
      },
    }),
    itemAdded: (context, event: { item: EnvironmentRecord }) => ({
      ...context,
      items: [...context.items, event.item].sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt),
      selectedId: event.item.id,
      focusEnvironmentId: event.item.id,
      entries: {
        ...context.entries,
        [event.item.id]: {
          base: toEnvironmentDetailsDraft(event.item),
          current: toEnvironmentDetailsDraft(event.item),
          saving: false,
          error: null,
          version: 1,
        },
      },
    }),
    itemDeleted: (context, event: { id: string }) => {
      const nextEntries = { ...context.entries }
      delete nextEntries[event.id]
      const nextItems = context.items.filter(item => item.id !== event.id)

      return {
        ...context,
        items: nextItems,
        entries: nextEntries,
        focusEnvironmentId: context.focusEnvironmentId === event.id ? null : context.focusEnvironmentId,
        selectedId: context.selectedId === event.id ? (nextItems[0]?.id ?? null) : context.selectedId,
      }
    },
  },
})

export function createEmptyEnvironmentEntry(): EnvironmentEntry {
  return {
    base: null,
    current: null,
    saving: false,
    error: null,
    version: 0,
  }
}

export function toEnvironmentDetailsDraft(environment: EnvironmentRecord): EnvironmentDetailsDraft {
  return {
    name: environment.name,
    variables: environment.variables,
    priority: environment.priority,
  }
}

export function serializeEnvironmentDraft(draft: EnvironmentDetailsDraft | null) {
  if (!draft) {
    return ''
  }

  return JSON.stringify(draft)
}

export function isEnvironmentEntryDirty(entry: EnvironmentEntry | null | undefined) {
  if (!entry?.current) {
    return false
  }

  return serializeEnvironmentDraft(entry.current) !== serializeEnvironmentDraft(entry.base)
}
