import { useEffect } from 'react'
import { GlobalShortcuts } from '@/lib/hooks/globalShortcuts'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import { useViews } from './useViews'
import { notifyViewsChanged } from './useViews'
import { ViewUiHelpers } from './viewUiStore'

const VIEW_RUN_SHORTCUTS_KEY = 'viewRunShortcuts'

export function useViewRunShortcuts() {
  const { items } = useViews()

  useEffect(() => {
    GlobalShortcuts.create({
      key: VIEW_RUN_SHORTCUTS_KEY,
      enabled: true,
      onShortcutChange: async (command, shortcut) => {
        const viewId = command.replace('view-run:', '')
        const view = items.find(item => item.id === viewId)
        if (!view) {
          return
        }

        if (shortcut !== null && typeof shortcut === 'string') {
          return
        }

        const result = await getWindowElectron().updateView({
          id: view.id,
          name: view.name,
          code: view.code,
          shortcut,
          layoutMode: view.layoutMode,
          splitRatio: view.splitRatio,
          rememberRequests: view.rememberRequests,
        })
        if (!result.success) {
          toast.show(result)
          return
        }

        notifyViewsChanged()
      },
      shortcuts: items.flatMap(view => {
        if (!view.shortcut) {
          return []
        }

        return [
          {
            command: `view-run:${view.id}`,
            code: view.shortcut,
            handler: event => {
              event?.preventDefault()
              ViewUiHelpers.openViewAndRun(view.id)
            },
            label: `[View] Run ${view.name}`,
          },
        ]
      }),
      sequences: [],
    })

    return () => {
      GlobalShortcuts.remove(VIEW_RUN_SHORTCUTS_KEY)
    }
  }, [items])
}
