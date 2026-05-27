import { useEffect } from 'react'
import { GlobalShortcuts } from './lib/hooks/globalShortcuts'
import { dialogActions } from './global/dialogStore'
import { CommandPalette } from './components/CommandPalette'

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
        {
          command: 'file_browser_show_shortcuts',
          code: { code: 'KeyK', ctrlKey: true, metaKey: true },
          handler: e => {
            e?.preventDefault()
            dialogActions.open({
              component: CommandPalette,
              props: {},
            })
          },
          label: 'Show keyboard shortcuts',
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
