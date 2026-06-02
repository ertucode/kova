import type { SharedScriptTarget } from './SharedScripts.js'
import type { ScriptAutocompletePhase } from '../ui/folders/scriptRuntimeDeclarations.js'

export const SUPERMAVEN_STATUS_STATES = [
  'disabled',
  'starting',
  'running-free',
  'running-pro',
  'not-installed',
  'not-configured',
  'error',
] as const

export type SupermavenStatusState = (typeof SUPERMAVEN_STATUS_STATES)[number]

export type SupermavenStatus = {
  state: SupermavenStatusState
  detail: string | null
}

export type SupermavenInlineSuggestionRequest = {
  documentPath: string
  content: string
  cursorOffset: number
  phase?: ScriptAutocompletePhase
  targets?: SharedScriptTarget[]
}

export type SupermavenInlineSuggestion = {
  text: string
  deleteCount: number
}
