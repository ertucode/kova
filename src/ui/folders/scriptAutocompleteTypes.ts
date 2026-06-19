import type { Completion } from '@codemirror/autocomplete'
import type { SharedScriptRecord } from '@common/SharedScripts'
import type { ScriptRuntimeDiagnostic } from '@common/ScriptAi'
import type { ScriptRuntimeContext } from './scriptRuntimeDeclarations'
import type { ScriptRuntimePackage } from './scriptRuntimeDiagnostics'

export type ScriptAutocompleteSharedScript = Pick<SharedScriptRecord, 'id' | 'name' | 'kind' | 'code' | 'targets' | 'isActive'>

export type ScriptAutocompletePackage = ScriptRuntimePackage

type ScriptRequestBase = {
  requestId: number
  runtimeContext: ScriptRuntimeContext
  code: string
  requestPaths?: string[][]
  sharedScripts?: ScriptAutocompleteSharedScript[]
  packages?: ScriptAutocompletePackage[]
}

export type ScriptAutocompleteRequest = ScriptRequestBase & {
  type: 'autocomplete'
  position: number
}

export type ScriptDiagnosticsRequest = ScriptRequestBase & {
  type: 'diagnostics'
}

export type ScriptHoverRequest = ScriptRequestBase & {
  type: 'hover'
  position: number
}

export type ScriptAutocompleteOption = {
  label: string
  type?: Completion['type']
  detail?: string
  info?: string
  applyText?: string
  boost?: number
}

export type ScriptAutocompleteSuccess = {
  requestId: number
  success: true
  from: number
  to: number
  options: ScriptAutocompleteOption[]
}

export type ScriptAutocompleteFailure = {
  requestId: number
  success: false
  error: string
}

export type ScriptAutocompleteResponse = ScriptAutocompleteSuccess | ScriptAutocompleteFailure

export type ScriptEditorDiagnostic = ScriptRuntimeDiagnostic

export type ScriptDiagnosticsSuccess = {
  requestId: number
  success: true
  diagnostics: ScriptEditorDiagnostic[]
}

export type ScriptDiagnosticsFailure = {
  requestId: number
  success: false
  error: string
}

export type ScriptDiagnosticsResponse = ScriptDiagnosticsSuccess | ScriptDiagnosticsFailure

export type ScriptHoverPart = {
  text: string
  kind: string
}

export type ScriptHoverTag = {
  name: string
  textParts: ScriptHoverPart[]
}

export type ScriptHoverInfo = {
  from: number
  to: number
  detailParts: ScriptHoverPart[]
  documentationParts: ScriptHoverPart[]
  tags: ScriptHoverTag[]
}

export type ScriptHoverSuccess = {
  requestId: number
  success: true
  hover: ScriptHoverInfo | null
}

export type ScriptHoverFailure = {
  requestId: number
  success: false
  error: string
}

export type ScriptHoverResponse = ScriptHoverSuccess | ScriptHoverFailure
