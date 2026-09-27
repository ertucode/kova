import { createContext } from 'react'
import type { CodeEditorFontScales, CodeEditorFontSizeScope } from './codeEditorFontSize'

export type CodeEditorFontSizeContextValue = {
  fontScales: CodeEditorFontScales
  setFontScale: (scope: CodeEditorFontSizeScope, scale: number) => number
  adjustFontScale: (scope: CodeEditorFontSizeScope, delta: number) => number
}

export const CodeEditorFontSizeContext = createContext<CodeEditorFontSizeContextValue | null>(null)
