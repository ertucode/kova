import type { AppUpdateCheckResult } from '@common/AppUpdate'
import { errorResponseToMessage } from '@common/GenericError'
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
import { DEFAULT_SERVER_LOG_MAX_SIZE_MB, type ServerLogConfig } from '@common/ServerLog'
import { formatTlsVerificationModeLabel } from '@/components/tlsVerificationMode'
import { getWindowElectron, windowArgs } from '@/getWindowElectron'
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
import {
  MAX_CODE_EDITOR_FONT_SCALE,
  MIN_CODE_EDITOR_FONT_SCALE,
  persistCodeEditorFontScale,
  readStoredCodeEditorFontScales,
  resetCodeEditorFontScale,
  type CodeEditorFontSizeScope,
} from './codeEditorFontSize'
import { getAutoHideFolderExplorer, setAutoHideFolderExplorer } from '@/folders/folderExplorerEditorStore'

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
  actions?: readonly CommandPaletteInputAction[]
}

export interface CommandPaletteInputAction {
  id: string
  label: string
  run(value: string): void | Promise<void>
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

let serverLogConfig: ServerLogConfig = windowArgs.serverLogConfig

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

export const autoHideFolderExplorerSetting: CommandPaletteBooleanConfig = {
  type: 'boolean',
  id: 'auto-hide-folder-explorer',
  label: 'Auto-hide folder explorer',
  description: 'Hide the folder explorer from the layout and show it as an overlay while it has focus after pressing Ctrl+P.',
  getValue: getAutoHideFolderExplorer,
  onChange: setAutoHideFolderExplorer,
  yesLabel: 'Hide until Ctrl+P',
  noLabel: 'Keep visible',
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

export const serverLogPathSetting: CommandPaletteInputConfig = {
  type: 'input',
  id: 'server-log-path',
  label: 'Server log path',
  description: formatServerLogPathDescription(),
  getValue: () => serverLogConfig.filePath,
  validate: value => (value.trim() === '' ? 'Enter a log file path.' : null),
  onChange: async value => {
    serverLogConfig = await getWindowElectron().updateServerLogConfig({ filePath: value.trim() })
    serverLogPathSetting.description = formatServerLogPathDescription()
  },
  placeholder: 'Path to the server log file',
  actions: [
    {
      id: 'show-in-file-explorer',
      label: 'Show in file explorer',
      run: async filePath => {
        const result = await getWindowElectron().openFileLocation(filePath)
        if (!result.success) {
          throw new Error(errorResponseToMessage(result.error))
        }
      },
    },
  ],
}

export const serverLogMaxSizeSetting: CommandPaletteInputConfig = {
  type: 'input',
  id: 'server-log-max-size',
  label: 'Server log maximum size',
  description: formatServerLogMaxSizeDescription(),
  getValue: () => String(serverLogConfig.maxSizeMb),
  validate: value => {
    const size = Number(value)
    return Number.isInteger(size) && size >= 1 && size <= 10_240 ? null : 'Enter a whole number between 1 and 10240 MB.'
  },
  onChange: async value => {
    serverLogConfig = await getWindowElectron().updateServerLogConfig({ maxSizeMb: Number(value) })
    serverLogMaxSizeSetting.description = formatServerLogMaxSizeDescription()
  },
  inputType: 'number',
  min: 1,
  max: 10_240,
  step: 1,
  placeholder: String(DEFAULT_SERVER_LOG_MAX_SIZE_MB),
}

function formatServerLogPathDescription() {
  return `Production server console output is written to: ${serverLogConfig.filePath}`
}

function formatServerLogMaxSizeDescription() {
  return `Maximum size in MB before the oldest logs are removed. Current: ${serverLogConfig.maxSizeMb} MB.`
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

export const resetCodeEditorFontSizeTrigger = {
  type: 'trigger',
  id: 'reset-code-editor-font-size',
  label: 'Reset Code Editor Font Size',
  description: 'Reset script, request body, and View runtime editors to their default font size.',
  trigger: () => resetCodeEditorFontScale('code-editor'),
} satisfies CommandPaletteTrigger

export const codeEditorFontSizeSetting = createCodeEditorFontSizeSetting({
  id: 'code-editor-font-size',
  label: 'Code Editor Font Size',
  description: 'Set the font size for script, request body, and View runtime editors. Default: 100%.',
  scope: 'code-editor',
})

export const responseCodeEditorFontSizeSetting = createCodeEditorFontSizeSetting({
  id: 'response-code-editor-font-size',
  label: 'Response Code Editor Font Size',
  description: 'Set the font size for response body and response visualizer runtime editors. Default: 100%.',
  scope: 'response-code-editor',
})

export const resetResponseCodeEditorFontSizeTrigger = {
  type: 'trigger',
  id: 'reset-response-code-editor-font-size',
  label: 'Reset Response Code Editor Font Size',
  description: 'Reset response body and response visualizer runtime editors to their default font size.',
  trigger: () => resetCodeEditorFontScale('response-code-editor'),
} satisfies CommandPaletteTrigger

export const commandPaletteConfigs: readonly CommandPaletteConfig[] = [
  appearanceSetting,
  autoHideFolderExplorerSetting,
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
  serverLogPathSetting,
  serverLogMaxSizeSetting,
  codeEditorFontSizeSetting,
  responseCodeEditorFontSizeSetting,
  resetCodeEditorFontSizeTrigger,
  resetResponseCodeEditorFontSizeTrigger,
  checkForUpdatesTrigger,
]

function createCodeEditorFontSizeSetting({
  id,
  label,
  description,
  scope,
}: {
  id: string
  label: string
  description: string
  scope: CodeEditorFontSizeScope
}): CommandPaletteInputConfig {
  const minPercentage = MIN_CODE_EDITOR_FONT_SCALE * 100
  const maxPercentage = MAX_CODE_EDITOR_FONT_SCALE * 100

  return {
    type: 'input',
    id,
    label,
    description,
    getValue: () => String(Math.round(readStoredCodeEditorFontScales()[scope] * 100)),
    validate: value => {
      const percentage = Number(value)
      return Number.isInteger(percentage)
        && percentage >= minPercentage
        && percentage <= maxPercentage
        ? null
        : `Enter a whole percentage between ${minPercentage}% and ${maxPercentage}%.`
    },
    onChange: value => persistCodeEditorFontScale(scope, Number(value) / 100),
    inputType: 'number',
    min: minPercentage,
    max: maxPercentage,
    step: 1,
    placeholder: '100',
  }
}

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
