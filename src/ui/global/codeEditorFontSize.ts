export type CodeEditorFontSizeScope = 'code-editor' | 'response-code-editor'
export type CodeEditorZoomScope = 'general' | 'response' | 'none'

export type CodeEditorFontScales = Record<CodeEditorFontSizeScope, number>

export const DEFAULT_CODE_EDITOR_FONT_SCALE = 1
export const MIN_CODE_EDITOR_FONT_SCALE = 0.6
export const MAX_CODE_EDITOR_FONT_SCALE = 2
export const CODE_EDITOR_FONT_SCALE_STEP = 0.01
export const CODE_EDITOR_FONT_SCALE_CHANGE_EVENT = 'kova-code-editor-font-scale-change'

const STORAGE_KEYS: Record<CodeEditorFontSizeScope, string> = {
  'code-editor': 'code-editor-font-scale',
  'response-code-editor': 'response-code-editor-font-scale',
}

export function resetCodeEditorFontScale(scope: CodeEditorFontSizeScope) {
  persistCodeEditorFontScale(scope, DEFAULT_CODE_EDITOR_FONT_SCALE)
}

export function normalizeCodeEditorFontScale(scale: number) {
  if (!Number.isFinite(scale)) {
    return DEFAULT_CODE_EDITOR_FONT_SCALE
  }
  return Math.min(MAX_CODE_EDITOR_FONT_SCALE, Math.max(MIN_CODE_EDITOR_FONT_SCALE, Math.round(scale * 100) / 100))
}

export function readStoredCodeEditorFontScales(): CodeEditorFontScales {
  return {
    'code-editor': readStoredFontScale('code-editor'),
    'response-code-editor': readStoredFontScale('response-code-editor'),
  }
}

export function isCodeEditorFontScaleStorageKey(key: string) {
  return Object.values(STORAGE_KEYS).includes(key)
}

export function persistCodeEditorFontScale(scope: CodeEditorFontSizeScope, scale: number) {
  const normalizedScale = normalizeCodeEditorFontScale(scale)
  try {
    localStorage.setItem(STORAGE_KEYS[scope], String(normalizedScale))
  } catch {
    // Sandboxed runtimes relay changes to their parent instead of persisting locally.
  }
  window.dispatchEvent(
    new CustomEvent(CODE_EDITOR_FONT_SCALE_CHANGE_EVENT, { detail: { scope, scale: normalizedScale } })
  )
}

function readStoredFontScale(scope: CodeEditorFontSizeScope) {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEYS[scope])
    return storedValue === null ? DEFAULT_CODE_EDITOR_FONT_SCALE : normalizeCodeEditorFontScale(Number(storedValue))
  } catch {
    return DEFAULT_CODE_EDITOR_FONT_SCALE
  }
}
