import { createStore } from '@xstate/store'
import type { CookieRecord, CookieSameSite } from '@common/Cookies'

export type CookieDetailsDraft = {
  name: string
  value: string
  domain: string
  path: string
  hostOnly: boolean
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite | null
  expiresAt: number | null
}

export type CookieEntry = {
  base: CookieDetailsDraft | null
  current: CookieDetailsDraft | null
  saving: boolean
  error: string | null
  version: number
}

type CookiesContext = {
  items: CookieRecord[]
  selectedId: string | null
  focusCookieId: string | null
  loading: boolean
  entries: Record<string, CookieEntry>
}

export const cookiesStore = createStore({
  context: {
    items: [],
    selectedId: null,
    focusCookieId: null,
    loading: false,
    entries: {},
  } as CookiesContext,
  on: {
    loadingStarted: context => ({
      ...context,
      loading: true,
    }),
    loadingFinished: context => ({
      ...context,
      loading: false,
    }),
    listLoaded: (context, event: { items: CookieRecord[] }) => {
      const nextEntries = Object.fromEntries(
        event.items.map(item => {
          const base = toCookieDetailsDraft(item)
          const existing = context.entries[item.id] ?? createEmptyCookieEntry()
          const current = isCookieEntryDirty(existing) ? existing.current : base

          return [
            item.id,
            {
              ...existing,
              base,
              current,
              error: null,
            } satisfies CookieEntry,
          ]
        })
      )

      return {
        ...context,
        items: sortCookieItems(event.items),
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
      focusCookieId: null,
    }),
    draftUpdated: (context, event: { id: string; draft: CookieDetailsDraft }) => {
      const entry = context.entries[event.id] ?? createEmptyCookieEntry()

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
          ...(context.entries[event.id] ?? createEmptyCookieEntry()),
          saving: true,
          error: null,
        },
      },
    }),
    entrySaved: (context, event: { item: CookieRecord; version: number }) => {
      const base = toCookieDetailsDraft(event.item)
      const existing = context.entries[event.item.id] ?? createEmptyCookieEntry()
      const nextCurrent = existing.version === event.version ? base : (existing.current ?? base)

      return {
        ...context,
        items: sortCookieItems(context.items.map(item => (item.id === event.item.id ? event.item : item))),
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
          ...(context.entries[event.id] ?? createEmptyCookieEntry()),
          saving: false,
          error: event.error,
        },
      },
    }),
    itemAdded: (context, event: { item: CookieRecord }) => ({
      ...context,
      items: sortCookieItems([...context.items, event.item]),
      selectedId: event.item.id,
      focusCookieId: event.item.id,
      entries: {
        ...context.entries,
        [event.item.id]: {
          base: toCookieDetailsDraft(event.item),
          current: toCookieDetailsDraft(event.item),
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
        focusCookieId: context.focusCookieId === event.id ? null : context.focusCookieId,
        selectedId: context.selectedId === event.id ? (nextItems[0]?.id ?? null) : context.selectedId,
      }
    },
    itemsCleared: context => ({
      ...context,
      items: [],
      entries: {},
      selectedId: null,
      focusCookieId: null,
    }),
  },
})

export function createEmptyCookieEntry(): CookieEntry {
  return {
    base: null,
    current: null,
    saving: false,
    error: null,
    version: 0,
  }
}

export function toCookieDetailsDraft(cookie: CookieRecord): CookieDetailsDraft {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    hostOnly: cookie.hostOnly,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expiresAt: cookie.expiresAt,
  }
}

export function sortCookieItems(items: CookieRecord[]) {
  return items
    .slice()
    .sort(
      (left, right) =>
        left.domain.localeCompare(right.domain) ||
        right.path.length - left.path.length ||
        left.path.localeCompare(right.path) ||
        left.name.localeCompare(right.name) ||
        right.updatedAt - left.updatedAt
    )
}

export function serializeCookieDraft(draft: CookieDetailsDraft | null) {
  if (!draft) {
    return ''
  }

  return JSON.stringify(draft)
}

export function isCookieEntryDirty(entry: CookieEntry | null | undefined) {
  if (!entry?.current) {
    return false
  }

  return serializeCookieDraft(entry.current) !== serializeCookieDraft(entry.base)
}
