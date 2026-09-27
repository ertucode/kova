import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CODE_EDITOR_FONT_SCALE,
  MAX_CODE_EDITOR_FONT_SCALE,
  MIN_CODE_EDITOR_FONT_SCALE,
  normalizeCodeEditorFontScale,
  resetCodeEditorFontScale,
} from './codeEditorFontSize'

describe('code editor font size preferences', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes scales to bounded one-percent steps', () => {
    expect(normalizeCodeEditorFontScale(1.234)).toBe(1.23)
    expect(normalizeCodeEditorFontScale(0)).toBe(MIN_CODE_EDITOR_FONT_SCALE)
    expect(normalizeCodeEditorFontScale(10)).toBe(MAX_CODE_EDITOR_FONT_SCALE)
    expect(normalizeCodeEditorFontScale(Number.NaN)).toBe(DEFAULT_CODE_EDITOR_FONT_SCALE)
  })

  it('resets general and response preferences independently', () => {
    localStorage.setItem('code-editor-font-scale', '1.5')
    localStorage.setItem('response-code-editor-font-scale', '0.8')

    resetCodeEditorFontScale('code-editor')
    expect(localStorage.getItem('code-editor-font-scale')).toBe(String(DEFAULT_CODE_EDITOR_FONT_SCALE))
    expect(localStorage.getItem('response-code-editor-font-scale')).toBe('0.8')

    resetCodeEditorFontScale('response-code-editor')
    expect(localStorage.getItem('response-code-editor-font-scale')).toBe(String(DEFAULT_CODE_EDITOR_FONT_SCALE))
  })
})
