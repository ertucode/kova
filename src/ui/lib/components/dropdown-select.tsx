import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '../functions/clsx'

export type DropdownSelectOption<T extends string> = {
  value: T
  label: ReactNode
  description?: ReactNode
}

export function DropdownSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  triggerClassName,
  menuClassName,
  renderValue,
}: {
  value: T
  options: DropdownSelectOption<T>[]
  onChange: (value: T) => void
  className?: string
  triggerClassName?: string
  menuClassName?: string
  renderValue?: (option: DropdownSelectOption<T>) => ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listId = useId()

  const selectedOption = options.find(option => option.value === value) ?? options[0]

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) {
        return
      }

      setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        buttonRef.current?.focus()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!selectedOption) {
    return null
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          'flex h-full w-full items-center justify-between gap-3 border-0 bg-transparent px-4 text-left text-sm font-semibold outline-none',
          triggerClassName
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={() => setIsOpen(current => !current)}
      >
        <span className="min-w-0 truncate">{renderValue ? renderValue(selectedOption) : selectedOption.label}</span>
        <ChevronDownIcon className={cn('size-4 shrink-0 text-base-content/45 transition', isOpen ? 'rotate-180' : '')} />
      </button>

      {isOpen ? (
        <div
          id={listId}
          role="listbox"
          className={cn(
            'absolute left-0 top-[calc(100%+0.5rem)] z-50 min-w-full overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/98 p-1 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm',
            menuClassName
          )}
        >
          {options.map(option => {
            const isSelected = option.value === value

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition',
                  isSelected ? 'bg-base-100/80 text-base-content' : 'text-base-content/75 hover:bg-base-100/55 hover:text-base-content'
                )}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{option.label}</div>
                  {option.description ? <div className="mt-0.5 text-xs text-base-content/45">{option.description}</div> : null}
                </div>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
