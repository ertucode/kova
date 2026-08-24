import { createStore } from '@xstate/store'
import {
  DEFAULT_COOKIES_ENABLED,
  DEFAULT_COMPACT_REQUEST_VIEW,
  DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE,
  DEFAULT_REQUEST_CODE_COPY_BEHAVIOR,
  DEFAULT_RESPONSE_BODY_DISPLAY_MODE,
  DEFAULT_SCRIPT_AI_MODEL,
  DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG,
  DEFAULT_SUPERMAVEN_ENABLED,
  DEFAULT_VIM_MODE,
  DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS,
  type AppSettingsRequestCodeCopyBehavior,
  type AppSettingsRecord,
  type UpdateAppSettingsInput,
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

  export async function saveSettings(input: UpdateAppSettingsInput) {
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

  export async function saveResponseBodyDisplayMode(responseBodyDisplayMode: AppSettingsRecord['responseBodyDisplayMode']) {
    return await saveSettings({ responseBodyDisplayMode })
  }
}

export function getWarnBeforeRequestAfterSeconds() {
  return (
    appSettingsStore.getSnapshot().context.settings?.warnBeforeRequestAfterSeconds ??
    DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS
  )
}

export function getResponseBodyDisplayMode() {
  return appSettingsStore.getSnapshot().context.settings?.responseBodyDisplayMode ?? DEFAULT_RESPONSE_BODY_DISPLAY_MODE
}

export function getCompactRequestView() {
  return appSettingsStore.getSnapshot().context.settings?.compactRequestView ?? DEFAULT_COMPACT_REQUEST_VIEW
}

export function getVimMode() {
  return appSettingsStore.getSnapshot().context.settings?.vimMode ?? DEFAULT_VIM_MODE
}

export function getCookiesEnabled() {
  return appSettingsStore.getSnapshot().context.settings?.cookiesEnabled ?? DEFAULT_COOKIES_ENABLED
}

export function getFormatScriptBlocksOnSave() {
  return appSettingsStore.getSnapshot().context.settings?.formatScriptBlocksOnSave ?? DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE
}

export function getSupermavenEnabled() {
  return appSettingsStore.getSnapshot().context.settings?.supermavenEnabled ?? DEFAULT_SUPERMAVEN_ENABLED
}

export function getScriptBlockPrettierConfig() {
  return appSettingsStore.getSnapshot().context.settings?.scriptBlockPrettierConfig ?? DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG
}

export function getScriptAiModel() {
  return appSettingsStore.getSnapshot().context.settings?.scriptAiModel ?? DEFAULT_SCRIPT_AI_MODEL
}

export function getRequestCodeCopyBehavior(): AppSettingsRequestCodeCopyBehavior {
  return appSettingsStore.getSnapshot().context.settings?.requestCodeCopyBehavior ?? DEFAULT_REQUEST_CODE_COPY_BEHAVIOR
}
