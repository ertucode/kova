import { clsx } from '@/lib/functions/clsx'
import { shortcutDisplayValueToString, type ShortcutDisplayValue } from '@/lib/hooks/shortcutUtils'

export function ShortcutDisplay({
  shortcut,
  placeholder = 'No shortcut',
  className,
}: {
  shortcut: ShortcutDisplayValue
  placeholder?: string
  className?: string
}) {
  const label = shortcutDisplayValueToString(shortcut)

  return (
    <kbd
      className={clsx(
        'px-2 py-1 text-xs font-semibold border rounded whitespace-nowrap leading-none',
        label
          ? 'text-gray-800 bg-gray-100 border-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'
          : 'text-gray-400 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700',
        className
      )}
    >
      {label || placeholder}
    </kbd>
  )
}
