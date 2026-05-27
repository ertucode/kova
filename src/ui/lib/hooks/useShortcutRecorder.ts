import { useEffect, useState } from 'react'
import { keyboardEventToShortcut, type RecordedShortcut } from './shortcutUtils'

export function useShortcutRecorder(isRecording: boolean) {
  const [recordedShortcut, setRecordedShortcut] = useState<RecordedShortcut | null>(null)

  useEffect(() => {
    if (!isRecording) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const nextShortcut = keyboardEventToShortcut(event)
      if (!nextShortcut) {
        return
      }

      setRecordedShortcut(nextShortcut)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isRecording])

  return {
    recordedShortcut,
    setRecordedShortcut,
    resetRecordedShortcut: () => setRecordedShortcut(null),
  }
}
