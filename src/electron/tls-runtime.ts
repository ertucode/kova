import { Agent, type Dispatcher } from 'undici'
import { type EffectiveTlsVerificationMode, resolveTlsVerificationModeWithInheritance, shouldDisableTlsVerification } from '../common/Tls.js'
import type { AppSettingsTlsVerificationMode, RequestTlsVerificationMode } from '../common/Tls.js'

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } })

export function resolveEffectiveTlsVerificationMode(options: {
  requestMode: RequestTlsVerificationMode
  folderModes: RequestTlsVerificationMode[]
  appSettingsMode: AppSettingsTlsVerificationMode
}): EffectiveTlsVerificationMode {
  return resolveTlsVerificationModeWithInheritance(options)
}

export function getTlsDispatcher(url: string, mode: EffectiveTlsVerificationMode): Dispatcher | undefined {
  return shouldDisableTlsVerification(url, mode) ? insecureDispatcher : undefined
}
