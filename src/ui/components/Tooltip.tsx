import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

type TooltipPosition = {
  top: number
  left: number
}

export function Tooltip({
  content,
  children,
  placement = 'left',
  className = '',
  tooltipClassName = '',
}: {
  content: string
  children: ReactNode
  placement?: TooltipPlacement
  className?: string
  tooltipClassName?: string
}) {
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      setPosition(getTooltipPosition(rect, placement))
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [isOpen, placement])

  if (!content.trim()) {
    return <>{children}</>
  }

  return (
    <>
      <div
        ref={triggerRef}
        className={className}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
      >
        {children}
      </div>
      {isOpen && position
        ? createPortal(
            <div
              className={[
                'tooltip tooltip-open fixed z-[120]',
                placement === 'top' ? 'tooltip-top' : '',
                placement === 'bottom' ? 'tooltip-bottom' : '',
                placement === 'right' ? 'tooltip-right' : '',
                placement === 'left' ? 'tooltip-left' : '',
                tooltipClassName,
              ].join(' ')}
              data-tip={content}
              style={{ top: position.top, left: position.left }}
            >
              <div className="size-0" />
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function getTooltipPosition(rect: DOMRect, placement: TooltipPlacement): TooltipPosition {
  switch (placement) {
    case 'top':
      return {
        top: rect.top,
        left: rect.left + rect.width / 2,
      }
    case 'bottom':
      return {
        top: rect.bottom,
        left: rect.left + rect.width / 2,
      }
    case 'right':
      return {
        top: rect.top + rect.height / 2,
        left: rect.right,
      }
    case 'left':
      return {
        top: rect.top + rect.height / 2,
        left: rect.left,
      }
  }
}
