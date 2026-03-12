import { getWindowElectron } from '@/getWindowElectron'
import { createStore } from '@xstate/store'

export type WindowStoreContext = {
  alwaysOnTop: boolean
  isCompactWindowSize: boolean
}

export const windowStore = createStore({
  context: {
    alwaysOnTop: false,
    isCompactWindowSize: false,
  } as WindowStoreContext,
  on: {
    setState: (context: WindowStoreContext, event: Partial<WindowStoreContext>) => ({
      ...context,
      ...event,
    }),
  },
})

export namespace WindowStoreHelpers {
  export const toggleWindowSize = async () => {
    const state = windowStore.getSnapshot().context
    if (state.isCompactWindowSize) {
      // Restore window size and minimize the tabset
      await getWindowElectron().restoreWindowSize()
      windowStore.trigger.setState({ isCompactWindowSize: false })
    } else {
      // Set compact window size and maximize the tabset
      await getWindowElectron().setCompactWindowSize()
      windowStore.trigger.setState({ isCompactWindowSize: true })
    }
  }

  export const toggleAlwaysOnTop = async (e: { metaKey: boolean }) => {
    const state = windowStore.getSnapshot().context
    const newValue = !state.alwaysOnTop
    await getWindowElectron().setAlwaysOnTop(newValue)
    windowStore.trigger.setState({ alwaysOnTop: newValue })

    // If metaKey is pressed, also toggle window size
    if (e.metaKey) {
      await toggleWindowSize()
    }
  }
}

import { GlobalShortcuts } from '@/lib/hooks/globalShortcuts'

const SHORTCUTS_KEY = 'windowStore'

export const WindowStoreShortcuts = {
  init: () => {
    GlobalShortcuts.create({
      key: SHORTCUTS_KEY,
      enabled: true,
      shortcuts: [
        {
          command: 'window_toggle_always_on_top_compact',
          code: { code: 'F1', metaKey: true },
          handler: () => WindowStoreHelpers.toggleAlwaysOnTop({ metaKey: true }),
          label: '[Window] Toggle Always On Top and Compact',
        },
        {
          command: 'window_toggle_compact_size',
          code: { code: 'F2', metaKey: true },
          handler: () => WindowStoreHelpers.toggleWindowSize(),
          label: '[Window] Toggle Compact Window Size',
        },
      ],
      sequences: [],
    })
  },
  deinit: () => {
    GlobalShortcuts.updateEnabled(SHORTCUTS_KEY, false)
  },
}

export const commands = [
  {
    code: { code: 'F1', metaKey: true },
    command: 'window_toggle_always_on_top_compact',
    label: '[Window] Toggle Always On Top and Compact',
  },
  {
    code: { code: 'F2', metaKey: true },
    command: 'window_toggle_compact_size',
    label: '[Window] Toggle Compact Window Size',
  },
]
