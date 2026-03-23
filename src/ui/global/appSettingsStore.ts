import { createStore } from '@xstate/store'
import {
  DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS,
  type AppSettingsRecord,
} from '@common/AppSettings'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

type AppSettingsContext = {
  settings: AppSettingsRecord | null
  loading: boolean
  saving: boolean
}

export const appSettingsStore = createStore({
  context: {
    settings: null,
    loading: false,
    saving: false,
  } as AppSettingsContext,
  on: {
    loadingStarted: context => ({
      ...context,
      loading: true,
    }),
    loaded: (context, event: { settings: AppSettingsRecord }) => ({
      ...context,
      settings: event.settings,
      loading: false,
      saving: false,
    }),
    loadFailed: context => ({
      ...context,
      loading: false,
    }),
    savingStarted: context => ({
      ...context,
      saving: true,
    }),
    savingFinished: context => ({
      ...context,
      saving: false,
    }),
  },
})

export namespace AppSettingsCoordinator {
  export async function loadSettings() {
    const state = appSettingsStore.getSnapshot().context
    if (state.loading) {
      return
    }

    appSettingsStore.trigger.loadingStarted()

    try {
      const settings = await getWindowElectron().getAppSettings()
      appSettingsStore.trigger.loaded({ settings })
    } catch (error) {
      appSettingsStore.trigger.loadFailed()
      toast.show({
        severity: 'error',
        title: 'Failed to load settings',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  export async function saveSettings(input: { warnBeforeRequestAfterSeconds: number }) {
    appSettingsStore.trigger.savingStarted()

    const result = await getWindowElectron().updateAppSettings(input)
    if (!result.success) {
      appSettingsStore.trigger.savingFinished()
      toast.show(result)
      return false
    }

    appSettingsStore.trigger.loaded({ settings: result.data })
    toast.show({ severity: 'success', title: 'Settings saved', message: 'App settings were updated.' })
    return true
  }
}

export function getWarnBeforeRequestAfterSeconds() {
  return (
    appSettingsStore.getSnapshot().context.settings?.warnBeforeRequestAfterSeconds ??
    DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS
  )
}
