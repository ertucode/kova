import type { Completion } from '@codemirror/autocomplete'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'

export type ScriptAutocompleteRequest = {
  requestId: number
  phase: ScriptAutocompletePhase
  code: string
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
