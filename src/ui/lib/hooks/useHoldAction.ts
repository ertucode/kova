import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'

const HOLD_DELAY_MS = 600

export function useHoldAction({
  onClick,
  onHold,
  disabled = false,
}: {
  onClick: () => void | Promise<void>
  onHold: () => void | Promise<void>
  disabled?: boolean
}) {
  const clickActionRef = useRef(onClick)
  const holdActionRef = useRef(onHold)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    clickActionRef.current = onClick
  }, [onClick])

  useEffect(() => {
    holdActionRef.current = onHold
  }, [onHold])

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    []
  )

  const clearPendingHold = () => {
    if (timeoutRef.current === null) {
      return false
    }

    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
    return true
  }

  return {
    onPointerDown: () => {
      if (disabled) {
        return
      }

      clearPendingHold()
      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null
        void holdActionRef.current()
      }, HOLD_DELAY_MS)
    },
    onPointerUp: () => {
      if (disabled) {
        return
      }

      if (clearPendingHold()) {
        void clickActionRef.current()
      }
    },
    onPointerLeave: () => {
      clearPendingHold()
    },
    onPointerCancel: () => {
      clearPendingHold()
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      if (disabled) {
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        void clickActionRef.current()
      }
    },
  }
}
