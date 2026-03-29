import { useEffect } from 'react'
import { GlobalShortcuts } from './lib/hooks/globalShortcuts'

const SHORTCUTS_KEY = 'appShortcuts'

export const AppShortcuts = {
  init: () => {
    GlobalShortcuts.create({
      key: SHORTCUTS_KEY,
      shortcuts: [
        {
          command: 'folder-explorer-focus-search',
          code: { code: 'KeyP', ctrlKey: true },
          handler: e => {
            e?.preventDefault()
            document.getElementById('folder-explorer-search-input')?.focus()
          },
          label: 'Focus search',
        },
      ],
      sequences: [],
      enabled: true,
    })
  },
  deinit: () => {
    GlobalShortcuts.updateEnabled(SHORTCUTS_KEY, false)
  },
}

export function useAppShortcuts() {
  useEffect(() => {
    AppShortcuts.init()
    return () => {
      AppShortcuts.deinit()
    }
  })
}
