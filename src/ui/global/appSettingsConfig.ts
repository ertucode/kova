import type { AppUpdateCheckResult } from '@common/AppUpdate'
import {
  APP_SETTINGS_REQUEST_CODE_COPY_BEHAVIORS,
  APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES,
  APP_SETTINGS_TLS_VERIFICATION_MODES,
  DEFAULT_SCRIPT_AI_SERVER_PORT,
  parseScriptBlockPrettierConfig,
  type AppSettingsRequestCodeCopyBehavior,
  type AppSettingsResponseBodyDisplayMode,
  type AppSettingsTlsVerificationMode,
} from '@common/AppSettings'
import { Typescript } from '@common/Typescript'
import { formatTlsVerificationModeLabel } from '@/components/tlsVerificationMode'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'
import {
  AppSettingsCoordinator,
  getCompactRequestView,
  getCookiesEnabled,
  getFormatScriptBlocksOnSave,
  getRequestCodeCopyBehavior,
  getResponseBodyDisplayMode,
  getScriptAiServerPort,
  getScriptAiModel,
  getScriptBlockPrettierConfig,
  getSupermavenEnabled,
  getTlsVerificationMode,
  getVimMode,
  getWarnBeforeRequestAfterSeconds,
} from './appSettingsStore'
import { getAppTheme, setAppTheme, type AppTheme } from './theme'
import { loadOpenCodeModels } from './useOpenCodeModels'

export interface CommandPaletteOption<Value extends string | boolean = string> {
  label: string
  value: Value
}

export interface CommandPaletteOptionConfig<Value extends string = string> {
  type: 'options'
  id: string
  label: string
  description: string
  getValue(): Value
  onChange(value: Value): void | Promise<void>
  options: readonly CommandPaletteOption<Value>[]
  loadOptions?(): Promise<readonly CommandPaletteOption<Value>[]>
}

export interface CommandPaletteBooleanConfig {
  type: 'boolean'
  id: string
  label: string
  description: string
  getValue(): boolean
  onChange(value: boolean): void | Promise<void>
  yesLabel?: string
  noLabel?: string
}

export interface CommandPaletteInputConfig {
  type: 'input'
  id: string
  label: string
  description: string
  getValue(): string
  onChange(value: string): void | Promise<void>
  validate?(value: string): string | null
  inputType?: 'text' | 'number'
  placeholder?: string
  min?: number
  max?: number
  step?: number
  textArea?: boolean
}

export interface CommandPaletteTrigger<Result = unknown> {
  type: 'trigger'
  id: string
  label: string
  description: string
  trigger(): Result | Promise<Result>
  onResult?(result: Result): void
}

export type CommandPaletteSelectionConfig = CommandPaletteOptionConfig | CommandPaletteBooleanConfig
export type CommandPaletteNestedConfig = CommandPaletteSelectionConfig | CommandPaletteInputConfig
export type CommandPaletteConfig = CommandPaletteNestedConfig | CommandPaletteTrigger

export const appearanceSetting: CommandPaletteOptionConfig<AppTheme> = {
  type: 'options',
  id: 'appearance',
  label: 'Appearance',
  description: 'Choose a theme for this device. Dark is the default.',
  getValue: getAppTheme,
  onChange: setAppTheme,
  options: [
    { label: 'Dark', value: 'dark' },
    { label: 'Light', value: 'light' },
  ],
}

export const warnBeforeRequestSetting: CommandPaletteInputConfig = {
  type: 'input',
  id: 'warn-before-request',
  label: 'Warn before request',
  description:
    'When an active environment has request warnings enabled, show a confirmation dialog if the last request is older than this threshold.',
  getValue: () => String(getWarnBeforeRequestAfterSeconds()),
  validate: value => (Number.isFinite(Number(value)) ? null : 'Enter a valid number of seconds.'),
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({
      warnBeforeRequestAfterSeconds: Math.max(0, Math.trunc(Number(value))),
    })
  },
  inputType: 'number',
  min: 0,
  step: 1,
}

export const responseBodyDisplaySetting: CommandPaletteOptionConfig<AppSettingsResponseBodyDisplayMode> = {
  type: 'options',
  id: 'response-body-display',
  label: 'Response body display',
  description:
    'Choose whether the Raw response view should default to the original payload or a formatted preview when formatting is available.',
  getValue: getResponseBodyDisplayMode,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ responseBodyDisplayMode: value })
  },
  options: APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.map(value => ({
    label: value === 'raw' ? 'Raw' : 'Formatted',
    value,
  })),
}

export const compactRequestViewSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'compact-request-view',
  label: 'Request details layout',
  description:
    'Keep request details compact by showing auth, headers, and path params beside the body. Turn it off to split them into separate tabs.',
  getValue: getCompactRequestView,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ compactRequestView: value })
  },
  yesLabel: 'Keep compact',
  noLabel: 'Use separate tabs',
}

export const formatScriptBlocksOnSaveSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'format-script-blocks-on-save',
  label: 'Format script blocks on save',
  description: 'Format request and script editor blocks with Prettier when they are saved.',
  getValue: getFormatScriptBlocksOnSave,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ formatScriptBlocksOnSave: value })
  },
  yesLabel: 'Enable',
  noLabel: 'Disable',
}

export const vimModeSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'vim-mode',
  label: 'Vim mode',
  description: 'Enable Vim keybindings in request and script editors.',
  getValue: getVimMode,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ vimMode: value })
  },
  yesLabel: 'Enable',
  noLabel: 'Disable',
}

export const cookiesSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'cookies',
  label: 'Cookies',
  description: 'Store and send cookies returned by requests.',
  getValue: getCookiesEnabled,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ cookiesEnabled: value })
  },
  yesLabel: 'Enable',
  noLabel: 'Disable',
}

export const tlsVerificationSetting: CommandPaletteOptionConfig<AppSettingsTlsVerificationMode> = {
  type: 'options',
  id: 'tls-verification',
  label: 'TLS verification',
  description:
    'Choose how request runtimes verify HTTPS and WSS certificates by default. Request-level overrides can make this stricter or looser.',
  getValue: getTlsVerificationMode,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ tlsVerificationMode: value })
  },
  options: APP_SETTINGS_TLS_VERIFICATION_MODES.map(value => ({
    label: formatTlsVerificationModeLabel(value),
    value,
  })),
}

export const requestCodeCopySetting: CommandPaletteOptionConfig<AppSettingsRequestCodeCopyBehavior> = {
  type: 'options',
  id: 'request-code-copy',
  label: 'Request code copy',
  description: 'Choose the default behavior for Copy as cURL and Copy as fetch.',
  getValue: getRequestCodeCopyBehavior,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ requestCodeCopyBehavior: value })
  },
  options: APP_SETTINGS_REQUEST_CODE_COPY_BEHAVIORS.map(value => ({
    label: formatRequestCodeCopyBehaviorLabel(value),
    value,
  })),
}

export const supermavenSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'supermaven',
  label: 'Supermaven Ghost Completions',
  description: 'Enable ghost completions for script editors. Suggestions are requested with Option+L.',
  getValue: getSupermavenEnabled,
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ supermavenEnabled: value })
  },
  yesLabel: 'Enable',
  noLabel: 'Disable',
}

export const scriptAiModelSetting: CommandPaletteOptionConfig = {
  type: 'options',
  id: 'script-ai-model',
  label: 'AI script model',
  description: 'Choose which OpenCode model should be used by default for script generation and refinement.',
  getValue: () => getScriptAiModel() ?? '',
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ scriptAiModel: value || null })
  },
  options: [{ label: 'OpenCode default', value: '' }],
  loadOptions: async () => {
    const result = await loadOpenCodeModels()
    return [
      { label: 'OpenCode default', value: '' },
      ...result.models.map(model => ({ label: model.id, value: model.id })),
    ]
  },
}

export const scriptAiServerPortSetting: CommandPaletteInputConfig = {
  type: 'input',
  id: 'script-ai-server-port',
  label: 'AI server port',
  description: `Leave empty to use Kova's default OpenCode server port: ${DEFAULT_SCRIPT_AI_SERVER_PORT}.`,
  getValue: () => {
    const value = getScriptAiServerPort()
    return value === null ? '' : String(value)
  },
  validate: value => {
    const trimmedValue = value.trim()
    if (trimmedValue === '') {
      return null
    }

    const port = Number(trimmedValue)
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? null : 'Enter a port between 1024 and 65535.'
  },
  onChange: async value => {
    const trimmedValue = value.trim()
    await AppSettingsCoordinator.saveSettings({
      scriptAiServerPort: trimmedValue === '' ? null : Number(trimmedValue),
    })
  },
  inputType: 'number',
  min: 1024,
  max: 65535,
  step: 1,
  placeholder: String(DEFAULT_SCRIPT_AI_SERVER_PORT),
}

export const scriptBlockPrettierConfigSetting: CommandPaletteInputConfig = {
  type: 'input',
  id: 'script-block-prettier-config',
  label: 'Prettier config JSON',
  description: 'Applies to script block format-on-save. Enter a JSON object with the desired Prettier options.',
  getValue: getScriptBlockPrettierConfig,
  validate: value => {
    try {
      parseScriptBlockPrettierConfig(value)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  },
  onChange: async value => {
    await AppSettingsCoordinator.saveSettings({ scriptBlockPrettierConfig: value })
  },
  textArea: true,
}

export const checkForUpdatesTrigger = {
  type: 'trigger',
  id: 'check-for-updates',
  label: 'Check for updates',
  description: 'Check whether a newer version of Kova is available.',
  trigger: () => getWindowElectron().checkForAppUpdates(),
  onResult: (result: AppUpdateCheckResult) => {
    toast.show({
      severity: result.status === 'update-available' ? 'info' : 'success',
      title: 'Update check complete',
      message: formatUpdateCheckResult(result),
    })
  },
} satisfies CommandPaletteTrigger<AppUpdateCheckResult>

export const commandPaletteConfigs: readonly CommandPaletteConfig[] = [
  appearanceSetting,
  warnBeforeRequestSetting,
  responseBodyDisplaySetting,
  compactRequestViewSetting,
  formatScriptBlocksOnSaveSetting,
  vimModeSetting,
  scriptBlockPrettierConfigSetting,
  cookiesSetting,
  tlsVerificationSetting,
  requestCodeCopySetting,
  supermavenSetting,
  scriptAiModelSetting,
  scriptAiServerPortSetting,
  checkForUpdatesTrigger,
]

export function getCommandPaletteOptions(
  config: CommandPaletteSelectionConfig
): readonly CommandPaletteOption<string | boolean>[] {
  switch (config.type) {
    case 'options':
      return config.options
    case 'boolean':
      return [
        { label: config.yesLabel ?? 'Yes', value: true },
        { label: config.noLabel ?? 'No', value: false },
      ]
    default:
      return Typescript.assertUnreachable(config)
  }
}

export function changeCommandPaletteOption(
  config: CommandPaletteSelectionConfig,
  value: string | boolean
): void | Promise<void> {
  switch (config.type) {
    case 'options':
      if (typeof value !== 'string') {
        throw new Error(`Invalid value for ${config.label}`)
      }
      return config.onChange(value)
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new Error(`Invalid value for ${config.label}`)
      }
      return config.onChange(value)
    default:
      return Typescript.assertUnreachable(config)
  }
}

export async function executeCommandPaletteTrigger(trigger: CommandPaletteTrigger) {
  const result = await trigger.trigger()
  trigger.onResult?.(result)
}

export function formatUpdateCheckResult(result: AppUpdateCheckResult) {
  switch (result.status) {
    case 'unsupported':
      return `Kova ${result.currentVersion}. Update checks are only available in installed Windows builds.`
    case 'up-to-date':
      return `Kova ${result.currentVersion} is up to date.`
    case 'update-available':
      return `Kova ${result.availableVersion} is available.`
    default:
      return Typescript.assertUnreachable(result)
  }
}

function formatRequestCodeCopyBehaviorLabel(mode: AppSettingsRequestCodeCopyBehavior) {
  switch (mode) {
    case 'resolved':
      return 'Resolved'
    case 'mask-auth':
      return 'Mask Auth'
    case 'mask-variables':
      return 'Mask Variables'
    default:
      return Typescript.assertUnreachable(mode)
  }
}
