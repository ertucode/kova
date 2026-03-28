import type { Completion } from '@codemirror/autocomplete'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'

type ScriptRequestBase = {
  requestId: number
  phase: ScriptAutocompletePhase
  code: string
}

export type ScriptAutocompleteRequest = ScriptRequestBase & {
  type: 'autocomplete'
  position: number
}

export type ScriptDiagnosticsRequest = ScriptRequestBase & {
  type: 'diagnostics'
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

export type ScriptEditorDiagnostic = {
  from: number
  to: number
  message: string
  line: number | null
  column: number | null
  sourceLine: string | null
}

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
