import type { AppSettingsTlsVerificationMode } from '@common/AppSettings'
import type { RequestTlsVerificationMode } from '@common/Requests'
import { Typescript } from '@common/Typescript'
import type { DropdownSelectOption } from '@/lib/components/dropdown-select'

type TlsVerificationMode = AppSettingsTlsVerificationMode | RequestTlsVerificationMode

export function formatTlsVerificationModeLabel(mode: TlsVerificationMode) {
  switch (mode) {
    case 'inherit':
      return 'Inherit'
    case 'strict':
      return 'Always Verify'
    case 'disable-for-localhost':
      return 'Disable For Localhost'
    case 'disable':
      return 'Disable'
    default:
      return Typescript.assertUnreachable(mode)
  }
}

export function buildTlsVerificationModeDropdownOptions<T extends TlsVerificationMode>(
  modes: readonly T[]
): DropdownSelectOption<T>[] {
  return modes.map(mode => ({ value: mode, label: <span>{formatTlsVerificationModeLabel(mode)}</span> }))
}
