import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  CODE_EDITOR_FONT_SCALE_CHANGE_EVENT,
  isCodeEditorFontScaleStorageKey,
  normalizeCodeEditorFontScale,
  persistCodeEditorFontScale,
  readStoredCodeEditorFontScales,
  type CodeEditorFontScales,
  type CodeEditorFontSizeScope,
} from './codeEditorFontSize'
import { CodeEditorFontSizeContext } from './codeEditorFontSizeContexts'

export function CodeEditorFontSizeProvider({
  children,
  fontScales: controlledFontScales,
  onFontScaleChange,
}: {
  children: ReactNode
  fontScales?: CodeEditorFontScales
  onFontScaleChange?: (scope: CodeEditorFontSizeScope, scale: number) => void
}) {
  const [storedFontScales, setStoredFontScales] = useState(readStoredCodeEditorFontScales)
  const fontScales = controlledFontScales ?? storedFontScales
  const fontScalesRef = useRef(fontScales)

  useEffect(() => {
    fontScalesRef.current = fontScales
  }, [fontScales])

  useEffect(() => {
    if (controlledFontScales) {
      return
    }

    const handleFontScaleChange = (event: Event) => {
      const { scope, scale } = (event as CustomEvent<{ scope: CodeEditorFontSizeScope; scale: number }>).detail
      setStoredFontScales(current => (current[scope] === scale ? current : { ...current, [scope]: scale }))
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key && !isCodeEditorFontScaleStorageKey(event.key)) {
        return
      }
      setStoredFontScales(readStoredCodeEditorFontScales())
    }

    window.addEventListener(CODE_EDITOR_FONT_SCALE_CHANGE_EVENT, handleFontScaleChange)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(CODE_EDITOR_FONT_SCALE_CHANGE_EVENT, handleFontScaleChange)
      window.removeEventListener('storage', handleStorage)
    }
  }, [controlledFontScales])

  const setFontScale = useCallback(
    (scope: CodeEditorFontSizeScope, scale: number) => {
      const normalizedScale = normalizeCodeEditorFontScale(scale)
      fontScalesRef.current = { ...fontScalesRef.current, [scope]: normalizedScale }
      if (controlledFontScales) {
        onFontScaleChange?.(scope, normalizedScale)
        return normalizedScale
      }

      persistCodeEditorFontScale(scope, normalizedScale)
      onFontScaleChange?.(scope, normalizedScale)
      return normalizedScale
    },
    [controlledFontScales, onFontScaleChange]
  )
  const adjustFontScale = useCallback(
    (scope: CodeEditorFontSizeScope, delta: number) => {
      return setFontScale(scope, fontScalesRef.current[scope] + delta)
    },
    [setFontScale]
  )

  const value = useMemo(
    () => ({ fontScales, setFontScale, adjustFontScale }),
    [adjustFontScale, fontScales, setFontScale]
  )
  return <CodeEditorFontSizeContext value={value}>{children}</CodeEditorFontSizeContext>
}
