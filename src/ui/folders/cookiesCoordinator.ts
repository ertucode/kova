import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'
import { confirmation } from '@/lib/components/confirmation'
import { toast } from '@/lib/components/toast'
import { type CookieDetailsDraft, cookiesStore, isCookieEntryDirty } from './cookiesStore'
import { folderExplorerEditorStore, saveFolderExplorerUiState, type SidebarTab } from './folderExplorerEditorStore'

const saveTokens: Record<string, number> = {}

export namespace CookiesCoordinator {
  export async function loadCookies() {
    cookiesStore.trigger.loadingStarted()

    try {
      const items = await getWindowElectron().listCookies()
      cookiesStore.trigger.listLoaded({ items })
    } catch (error) {
      cookiesStore.trigger.loadingFinished()
      toast.show({
        severity: 'error',
        title: 'Failed to load cookies',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export function selectCookie(id: string | null) {
    cookiesStore.trigger.selectedChanged({ id })
  }

  export function openCookiesPanel(id?: string) {
    setSidebarTab('cookies')
    if (id) {
      selectCookie(id)
    }
  }

  export async function createCookie() {
    const result = await getWindowElectron().createCookie({
      name: buildDefaultCookieName(),
      value: '',
      domain: 'localhost',
      path: '/',
      hostOnly: true,
      secure: false,
      httpOnly: false,
      sameSite: 'lax',
      expiresAt: null,
    })
    if (!result.success) {
      toast.show(result)
      return
    }

    cookiesStore.trigger.itemAdded({ item: result.data })
  }

  export function updateDraft(id: string, draft: CookieDetailsDraft) {
    cookiesStore.trigger.draftUpdated({ id, draft })
  }

  export async function saveCookie(id: string) {
    const state = cookiesStore.getSnapshot().context
    const entry = state.entries[id]
    if (!entry?.current || !isCookieEntryDirty(entry)) {
      return
    }

    const version = entry.version
    const token = (saveTokens[id] ?? 0) + 1
    saveTokens[id] = token
    cookiesStore.trigger.entrySavingStarted({ id })

    const result = await getWindowElectron().updateCookie({
      id,
      ...entry.current,
    })

    if (saveTokens[id] !== token) {
      return
    }

    if (!result.success) {
      cookiesStore.trigger.entrySaveFailed({ id, error: errorResponseToMessage(result.error) })
      toast.show({ severity: 'error', title: 'Could not save cookie', message: errorResponseToMessage(result.error) })
      return
    }

    cookiesStore.trigger.entrySaved({ item: result.data, version })
  }

  export function requestDeleteCookie(id: string, name: string) {
    confirmation.trigger.confirm({
      title: 'Delete cookie?',
      message: `"${name}" will be removed from the cookie jar.`,
      confirmText: 'Delete',
      onConfirm: async () => {
        const result = await getWindowElectron().deleteCookie({ id })
        if (!result.success) {
          toast.show(result)
          return
        }

        cookiesStore.trigger.itemDeleted({ id })
      },
    })
  }

  export function requestClearCookies() {
    confirmation.trigger.confirm({
      title: 'Clear all cookies?',
      message: 'All stored cookies will be removed.',
      confirmText: 'Clear all',
      onConfirm: async () => {
        const result = await getWindowElectron().clearCookies({})
        if (!result.success) {
          toast.show(result)
          return
        }

        cookiesStore.trigger.itemsCleared()
      },
    })
  }

  export function setSidebarTab(sidebarTab: SidebarTab) {
    folderExplorerEditorStore.trigger.sidebarTabChanged({ sidebarTab })
    persistUiState()
  }
}

function persistUiState() {
  const { selected, expandedIds } = folderExplorerEditorStore.getSnapshot().context
  saveFolderExplorerUiState(selected, expandedIds)
}

function buildDefaultCookieName() {
  const existingNames = new Set(cookiesStore.getSnapshot().context.items.map(item => item.name))
  if (!existingNames.has('new_cookie')) {
    return 'new_cookie'
  }

  let index = 2
  while (existingNames.has(`new_cookie_${index}`)) {
    index += 1
  }

  return `new_cookie_${index}`
}
