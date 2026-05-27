import type { ShortcutCode } from './useShortcuts'

export type ShortcutDisplayValue = ShortcutCode | ShortcutCode[] | { sequence: string[] } | null
export type RecordedShortcut = Exclude<ShortcutCode, string>

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

export function isModifierOnlyKeyboardEvent(event: Pick<KeyboardEvent, 'key'>) {
  return MODIFIER_KEYS.has(event.key)
}

export function keyboardEventToShortcut(event: KeyboardEvent): RecordedShortcut | null {
  if (isModifierOnlyKeyboardEvent(event)) {
    return null
  }

  return {
    code: event.code,
    metaKey: event.metaKey || undefined,
    ctrlKey: event.ctrlKey || undefined,
    altKey: event.altKey || undefined,
    shiftKey: event.shiftKey || undefined,
  }
}

export function shortcutKeyString(key: string) {
  if (key === ' ' || key === 'Space') {
    return 'Space'
  }

  return key
}

export function shortcutToString(shortcut: ShortcutCode): string {
  if (typeof shortcut === 'string') {
    return shortcutKeyString(shortcut)
  }

  const parts: string[] = []
  if (shortcut.metaKey) {
    parts.push('⌘')
  }

  if (shortcut.ctrlKey) {
    parts.push('Ctrl')
  }

  if (shortcut.altKey) {
    parts.push('Alt')
  }

  if (shortcut.shiftKey) {
    parts.push('Shift')
  }

  parts.push(shortcutKeyString(shortcut.code))

  return parts.join('+')
}

export function shortcutDisplayValueToString(shortcut: ShortcutDisplayValue): string {
  if (!shortcut) {
    return ''
  }

  if (typeof shortcut === 'object' && 'sequence' in shortcut) {
    return shortcut.sequence.join(' ')
  }

  if (Array.isArray(shortcut)) {
    return shortcut.map(shortcutToString).join(' or ')
  }

  return shortcutToString(shortcut)
}
