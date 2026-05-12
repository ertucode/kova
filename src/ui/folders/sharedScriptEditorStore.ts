import { createStore } from '@xstate/store'
import type { SharedScriptRecord, SharedScriptScopeType } from '@common/SharedScripts'
import { z } from 'zod'

const PERSISTED_SELECTED_SCRIPT_IDS_KEY = 'sharedScriptEditor:selectedIdsByScope'
const persistedSelectedScriptIdsSchema = z.record(z.string(), z.string().nullable())

export type SharedScriptEntry = {
  base: SharedScriptRecord
  current: SharedScriptRecord
  saving: boolean
  selection: SharedScriptEditorSelection | null
}

export type SharedScriptEditorSelection = {
  anchor: number
  head: number
}

type SharedScriptEditorContext = {
  entriesByScope: Record<string, Record<string, SharedScriptEntry>>
  selectedIdsByScope: Record<string, string | null>
  focusIdsByScope: Record<string, string | null>
}

export const sharedScriptEditorStore = createStore({
  context: {
    entriesByScope: {},
    selectedIdsByScope: loadPersistedSelectedScriptIdsByScope(),
    focusIdsByScope: {},
  } as SharedScriptEditorContext,
  on: {
    scriptsLoaded: (context, event: { scopeKey: string; items: SharedScriptRecord[] }) => {
      const currentEntries = context.entriesByScope[event.scopeKey] ?? {}
      const nextEntries: Record<string, SharedScriptEntry> = {}

      for (const script of event.items) {
        const existing = currentEntries[script.id]
        if (!existing) {
          nextEntries[script.id] = { base: script, current: script, saving: false, selection: null }
          continue
        }

        nextEntries[script.id] = {
          base: script,
          current: isSharedScriptEntryDirty(existing) ? existing.current : script,
          saving: existing.saving,
          selection: existing.selection,
        }
      }

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: nextEntries,
        },
      }
    },
    selectedChanged: (context, event: { scopeKey: string; id: string | null }) => ({
      ...context,
      selectedIdsByScope: {
        ...context.selectedIdsByScope,
        [event.scopeKey]: event.id,
      },
    }),
    focusRequested: (context, event: { scopeKey: string; id: string | null }) => ({
      ...context,
      focusIdsByScope: {
        ...context.focusIdsByScope,
        [event.scopeKey]: event.id,
      },
    }),
    focusHandled: (context, event: { scopeKey: string }) => ({
      ...context,
      focusIdsByScope: {
        ...context.focusIdsByScope,
        [event.scopeKey]: null,
      },
    }),
    draftUpdated: (context, event: { scopeKey: string; id: string; draft: SharedScriptRecord }) => {
      const scopeEntries = context.entriesByScope[event.scopeKey] ?? {}
      const entry = scopeEntries[event.id]
      if (!entry) {
        return context
      }

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: {
            ...scopeEntries,
            [event.id]: {
              ...entry,
              current: event.draft,
            },
          },
        },
      }
    },
    selectionUpdated: (
      context,
      event: { scopeKey: string; id: string; selection: SharedScriptEditorSelection | null }
    ) => {
      const scopeEntries = context.entriesByScope[event.scopeKey] ?? {}
      const entry = scopeEntries[event.id]
      if (!entry) {
        return context
      }

      if (
        entry.selection?.anchor === event.selection?.anchor
        && entry.selection?.head === event.selection?.head
      ) {
        return context
      }

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: {
            ...scopeEntries,
            [event.id]: {
              ...entry,
              selection: event.selection,
            },
          },
        },
      }
    },
    entrySavingStarted: (context, event: { scopeKey: string; id: string; draft: SharedScriptRecord }) => {
      const scopeEntries = context.entriesByScope[event.scopeKey] ?? {}
      const entry = scopeEntries[event.id]
      if (!entry) {
        return context
      }

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: {
            ...scopeEntries,
            [event.id]: {
              ...entry,
              current: event.draft,
              saving: true,
            },
          },
        },
      }
    },
    entrySavingFinished: (context, event: { scopeKey: string; id: string }) => {
      const scopeEntries = context.entriesByScope[event.scopeKey] ?? {}
      const entry = scopeEntries[event.id]
      if (!entry) {
        return context
      }

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: {
            ...scopeEntries,
            [event.id]: {
              ...entry,
              saving: false,
            },
          },
        },
      }
    },
    itemDeleted: (context, event: { scopeKey: string; id: string; nextSelectedId: string | null }) => {
      const scopeEntries = { ...(context.entriesByScope[event.scopeKey] ?? {}) }
      delete scopeEntries[event.id]

      return {
        ...context,
        entriesByScope: {
          ...context.entriesByScope,
          [event.scopeKey]: scopeEntries,
        },
        selectedIdsByScope: {
          ...context.selectedIdsByScope,
          [event.scopeKey]: event.nextSelectedId,
        },
        focusIdsByScope: {
          ...context.focusIdsByScope,
          [event.scopeKey]: context.focusIdsByScope[event.scopeKey] === event.id ? null : context.focusIdsByScope[event.scopeKey] ?? null,
        },
      }
    },
  },
})

sharedScriptEditorStore.subscribe(state => {
  persistSelectedScriptIdsByScope(state.context.selectedIdsByScope)
})

export function getSharedScriptScopeKey(scopeType: SharedScriptScopeType, scopeId: string | null) {
  return `${scopeType}:${scopeId ?? ''}`
}

export function serializeSharedScript(script: SharedScriptRecord) {
  return JSON.stringify({
    name: script.name,
    kind: script.kind,
    targets: script.targets,
    isActive: script.isActive,
    code: script.code,
  })
}

export function isSharedScriptEntryDirty(entry: SharedScriptEntry | null | undefined) {
  if (!entry) {
    return false
  }

  return serializeSharedScript(entry.base) !== serializeSharedScript(entry.current)
}

function loadPersistedSelectedScriptIdsByScope() {
  try {
    const value = localStorage.getItem(PERSISTED_SELECTED_SCRIPT_IDS_KEY)
    if (!value) {
      return {}
    }

    return persistedSelectedScriptIdsSchema.parse(JSON.parse(value))
  } catch {
    return {}
  }
}

function persistSelectedScriptIdsByScope(selectedIdsByScope: Record<string, string | null>) {
  try {
    localStorage.setItem(PERSISTED_SELECTED_SCRIPT_IDS_KEY, JSON.stringify(selectedIdsByScope))
  } catch {
    return
  }
}
