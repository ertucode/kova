import { Typescript } from './Typescript.js'

export const APP_SETTINGS_LOCALHOST_TLS_VERIFICATION_MODES = ['strict', 'disable-for-localhost'] as const
export const DEFAULT_APP_SETTINGS_LOCALHOST_TLS_VERIFICATION_MODE = 'strict'

export const REQUEST_LOCALHOST_TLS_VERIFICATION_MODES = ['inherit', 'strict', 'disable-for-localhost'] as const
export const DEFAULT_REQUEST_LOCALHOST_TLS_VERIFICATION_MODE = 'inherit'

export const APP_SETTINGS_TLS_VERIFICATION_MODES = ['strict', 'disable-for-localhost', 'disable'] as const
export const DEFAULT_APP_SETTINGS_TLS_VERIFICATION_MODE = 'strict'

export const REQUEST_TLS_VERIFICATION_MODES = ['inherit', 'strict', 'disable-for-localhost', 'disable'] as const
export const DEFAULT_REQUEST_TLS_VERIFICATION_MODE = 'inherit'

export type AppSettingsLocalhostTlsVerificationMode = (typeof APP_SETTINGS_LOCALHOST_TLS_VERIFICATION_MODES)[number]
export type RequestLocalhostTlsVerificationMode = (typeof REQUEST_LOCALHOST_TLS_VERIFICATION_MODES)[number]
export type EffectiveLocalhostTlsVerificationMode = Exclude<RequestLocalhostTlsVerificationMode, 'inherit'>
export type AppSettingsTlsVerificationMode = (typeof APP_SETTINGS_TLS_VERIFICATION_MODES)[number]
export type RequestTlsVerificationMode = (typeof REQUEST_TLS_VERIFICATION_MODES)[number]
export type EffectiveTlsVerificationMode = Exclude<RequestTlsVerificationMode, 'inherit'>

export function resolveTlsVerificationMode(
  requestMode: RequestTlsVerificationMode,
  appSettingsMode: AppSettingsTlsVerificationMode
): EffectiveTlsVerificationMode {
  switch (requestMode) {
    case 'inherit':
      return appSettingsMode
    case 'strict':
      return 'strict'
    case 'disable-for-localhost':
      return 'disable-for-localhost'
    case 'disable':
      return 'disable'
    default:
      return Typescript.assertUnreachable(requestMode)
  }
}

export function resolveTlsVerificationModeWithInheritance(options: {
  requestMode: RequestTlsVerificationMode
  folderModes: RequestTlsVerificationMode[]
  appSettingsMode: AppSettingsTlsVerificationMode
}): EffectiveTlsVerificationMode {
  if (options.requestMode !== 'inherit') {
    return resolveTlsVerificationMode(options.requestMode, options.appSettingsMode)
  }

  for (let index = options.folderModes.length - 1; index >= 0; index -= 1) {
    const folderMode = options.folderModes[index]
    if (folderMode !== 'inherit') {
      return resolveTlsVerificationMode(folderMode, options.appSettingsMode)
    }
  }

  return options.appSettingsMode
}

export function shouldDisableTlsVerification(rawUrl: string, mode: EffectiveTlsVerificationMode): boolean {
  switch (mode) {
    case 'strict':
      return false
    case 'disable':
      return true
    case 'disable-for-localhost':
      return shouldDisableTlsVerificationForUrl(rawUrl, 'disable-for-localhost')
    default:
      return Typescript.assertUnreachable(mode)
  }
}

export function resolveLocalhostTlsVerificationMode(
  requestMode: RequestLocalhostTlsVerificationMode,
  appSettingsMode: AppSettingsLocalhostTlsVerificationMode
): EffectiveLocalhostTlsVerificationMode {
  switch (requestMode) {
    case 'inherit':
      return appSettingsMode
    case 'strict':
      return 'strict'
    case 'disable-for-localhost':
      return 'disable-for-localhost'
    default:
      return Typescript.assertUnreachable(requestMode)
  }
}

export function shouldDisableTlsVerificationForUrl(
  rawUrl: string,
  mode: EffectiveLocalhostTlsVerificationMode
): boolean {
  switch (mode) {
    case 'strict':
      return false
    case 'disable-for-localhost':
      break
    default:
      return Typescript.assertUnreachable(mode)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    return false
  }

  const protocol = parsedUrl.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'wss:') {
    return false
  }

  return isLoopbackHostname(parsedUrl.hostname)
}

function isLoopbackHostname(hostname: string) {
  const normalizedHostname = normalizeHostname(hostname)
  if (normalizedHostname === 'localhost' || normalizedHostname.endsWith('.localhost')) {
    return true
  }

  if (normalizedHostname === '::1' || normalizedHostname.startsWith('::ffff:127.')) {
    return true
  }

  const ipv4Parts = normalizedHostname.split('.')
  return ipv4Parts.length === 4 && ipv4Parts.every(part => /^\d+$/.test(part)) && ipv4Parts[0] === '127'
}

function normalizeHostname(hostname: string) {
  const trimmed = hostname.trim().toLowerCase()
  return trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
}
