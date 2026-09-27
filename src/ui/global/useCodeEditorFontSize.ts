import { useCallback, useContext } from 'react'
import {
  CODE_EDITOR_FONT_SCALE_STEP,
  DEFAULT_CODE_EDITOR_FONT_SCALE,
  type CodeEditorFontSizeScope,
  type CodeEditorZoomScope,
} from './codeEditorFontSize'
import { CodeEditorFontSizeContext } from './codeEditorFontSizeContexts'

export function useCodeEditorFontSize(zoomScope: CodeEditorZoomScope = 'general') {
  const context = useContext(CodeEditorFontSizeContext)
  const scope: CodeEditorFontSizeScope = zoomScope === 'response' ? 'response-code-editor' : 'code-editor'
  const zoomEnabled = zoomScope !== 'none'
  const fontScale = zoomEnabled
    ? (context?.fontScales[scope] ?? DEFAULT_CODE_EDITOR_FONT_SCALE)
    : DEFAULT_CODE_EDITOR_FONT_SCALE

  const setFontScale = useCallback(
    (scale: number) => {
      return zoomEnabled ? context?.setFontScale(scope, scale) : undefined
    },
    [context, scope, zoomEnabled]
  )
  const zoomIn = useCallback(
    () => (zoomEnabled ? context?.adjustFontScale(scope, CODE_EDITOR_FONT_SCALE_STEP) : undefined),
    [context, scope, zoomEnabled]
  )
  const zoomOut = useCallback(
    () => (zoomEnabled ? context?.adjustFontScale(scope, -CODE_EDITOR_FONT_SCALE_STEP) : undefined),
    [context, scope, zoomEnabled]
  )

  return { fontScale, setFontScale, zoomIn, zoomOut, zoomEnabled }
}
