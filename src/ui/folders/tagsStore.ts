import { createStore } from '@xstate/store'
import type { TagAssignmentRecord, TagRecord } from '@common/Tags'
import { z } from 'zod'

const PERSISTED_SELECTED_TAG_KEY = 'tags:selectedId'
const persistedSelectedTagSchema = z.string().nullable()

type TagsContext = {
  items: TagRecord[]
  assignments: TagAssignmentRecord[]
  loading: boolean
  selectedId: string | null
  focusTagId: string | null
}

export const tagsStore = createStore({
  context: {
    items: [],
    assignments: [],
    loading: false,
    selectedId: loadPersistedSelectedTagId(),
    focusTagId: null,
  } as TagsContext,
  on: {
    loadingStarted: context => ({ ...context, loading: true }),
    loaded: (context, event: { items: TagRecord[]; assignments: TagAssignmentRecord[] }) => ({
      ...context,
      items: event.items,
      assignments: event.assignments,
      loading: false,
      selectedId:
        context.selectedId && event.items.some(item => item.id === context.selectedId)
          ? context.selectedId
          : (event.items[0]?.id ?? null),
    }),
    loadingFinished: context => ({ ...context, loading: false }),
    selectedChanged: (context, event: { id: string | null }) => ({ ...context, selectedId: event.id }),
    focusRequested: (context, event: { id: string }) => ({ ...context, focusTagId: event.id, selectedId: event.id }),
    focusHandled: context => ({ ...context, focusTagId: null }),
  },
})

tagsStore.subscribe(state => {
  persistSelectedTagId(state.context.selectedId)
})

export function getTagsForItem(itemType: 'folder' | 'request', itemId: string) {
  const { items, assignments } = tagsStore.getSnapshot().context
  const tagIds = new Set(
    assignments.filter(assignment => assignment.itemType === itemType && assignment.itemId === itemId).map(assignment => assignment.tagId)
  )
  return items.filter(item => tagIds.has(item.id))
}

export function getItemIdsForTag(tagId: string) {
  return tagsStore.getSnapshot().context.assignments.filter(assignment => assignment.tagId === tagId)
}

function loadPersistedSelectedTagId() {
  try {
    const value = localStorage.getItem(PERSISTED_SELECTED_TAG_KEY)
    if (!value) {
      return null
    }

    return persistedSelectedTagSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

function persistSelectedTagId(selectedId: string | null) {
  try {
    localStorage.setItem(PERSISTED_SELECTED_TAG_KEY, JSON.stringify(selectedId))
  } catch {
    return
  }
}
