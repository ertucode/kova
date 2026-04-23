import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '@/lib/components/dialog'
import { shortcutRegistryAPI } from '@/lib/hooks/shortcutRegistry'
import { KeyboardIcon, Edit2Icon, XIcon, RotateCcwIcon, AlertTriangleIcon } from 'lucide-react'
import { Button } from '@/lib/components/button'
import { ShortcutCode, isSequenceShortcut, useShortcuts } from '@/lib/hooks/useShortcuts'
import { clsx } from '@/lib/functions/clsx'
import Fuse from 'fuse.js'
import { shortcutCustomizationHelpers, shortcutCustomizationStore } from '@/lib/hooks/shortcutCustomization'
import { useSelector } from '@xstate/store/react'
import { dialogActions } from '@/global/dialogStore'
import { Tooltip } from './Tooltip'

export const CommandPalette = function CommandPalette(_props: {}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCommand, setEditingCommand] = useState<string | null>(null)
  const [recordedKeys, setRecordedKeys] = useState<KeyboardEvent | null>(null)
  const [isSearchingByKeymap, setIsSearchingByKeymap] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const customShortcuts = useSelector(shortcutCustomizationStore, state => state.context.customShortcuts)

  const shortcuts = useMemo(() => {
    return shortcutRegistryAPI.getAll()
  }, [])

  // Detect duplicate keymaps in O(N) time
  const duplicateCommands = useMemo(() => {
    const codeMap = new Map<string, string[]>() // code -> commands[]

    for (const shortcut of shortcuts) {
      const code = isSequenceShortcut(shortcut.shortcut)
        ? `seq:${shortcut.shortcut.sequence.join(',')}`
        : Array.isArray(shortcut.shortcut.code)
          ? shortcut.shortcut.code
              .map(c =>
                typeof c === 'string'
                  ? c
                  : `${c.code}:${c.metaKey ? 'M' : ''}${c.ctrlKey ? 'C' : ''}${c.altKey ? 'A' : ''}${c.shiftKey ? 'S' : ''}`
              )
              .sort()
              .join('|')
          : typeof shortcut.shortcut.code === 'string'
            ? shortcut.shortcut.code
            : `${shortcut.shortcut.code.code}:${shortcut.shortcut.code.metaKey ? 'M' : ''}${shortcut.shortcut.code.ctrlKey ? 'C' : ''}${shortcut.shortcut.code.altKey ? 'A' : ''}${shortcut.shortcut.code.shiftKey ? 'S' : ''}`

      const existing = codeMap.get(code) || []
      existing.push(shortcut.command)
      codeMap.set(code, existing)
    }

    // Find all commands that share codes with others
    const duplicates = new Set<string>()
    for (const [_, commands] of codeMap) {
      if (commands.length > 1) {
        for (const cmd of commands) {
          duplicates.add(cmd)
        }
      }
    }

    return duplicates
  }, [shortcuts])

  const fuse = useMemo(() => {
    return new Fuse(shortcuts, {
      keys: ['label'],
      threshold: 0.4,
      ignoreLocation: true,
    })
  }, [shortcuts])

  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) {
      return shortcuts
    }
    if (isSearchingByKeymap) {
      // Search by keymap - match against shortcut key combinations
      const searchLower = searchQuery.toLowerCase()
      return shortcuts.filter(shortcut => {
        const hasCustom = shortcutCustomizationHelpers.hasCustomShortcut(shortcut.command)
        const displayShortcut = hasCustom
          ? customShortcuts[shortcut.command]
          : isSequenceShortcut(shortcut.shortcut)
            ? { sequence: shortcut.shortcut.sequence }
            : shortcut.shortcut.code

        let keymapStr = ''
        if (typeof displayShortcut === 'object' && 'sequence' in displayShortcut) {
          keymapStr = displayShortcut.sequence.join(' ')
        } else if (Array.isArray(displayShortcut)) {
          keymapStr = displayShortcut.map(shortcutToString).join(' or ')
        } else {
          keymapStr = shortcutToString(displayShortcut)
        }

        return keymapStr.toLowerCase().includes(searchLower)
      })
    }
    return fuse.search(searchQuery).map(result => result.item)
  }, [searchQuery, shortcuts, fuse, isSearchingByKeymap, customShortcuts])

  useShortcuts(
    [
      {
        code: [{ code: 'ArrowDown' }, { code: 'KeyJ', ctrlKey: true }],
        handler: e => {
          e?.preventDefault()
          setSelectedIndex(prev => (prev + 1 === filteredShortcuts.length ? 0 : prev + 1))
        },
        label: '',
        enabledIn: () => true,
      },
      {
        code: [{ code: 'ArrowUp' }, { code: 'KeyK', ctrlKey: true }],
        handler: e => {
          e?.preventDefault()
          setSelectedIndex(prev => {
            return prev - 1 === -1 ? filteredShortcuts.length - 1 : prev - 1
          })
        },
        label: '',
        enabledIn: () => true,
      },
      {
        code: { code: 'Enter' },
        handler: e => {
          e?.preventDefault()
          if (filteredShortcuts[selectedIndex]) {
            dialogActions.close()
            filteredShortcuts[selectedIndex].shortcut.handler(undefined)
          }
        },
        label: '',
        enabledIn: () => true,
      },
      {
        code: { code: 'Escape', metaKey: true },
        handler: e => {
          e?.preventDefault()
          setIsSearchingByKeymap(true)
          setSearchQuery('')
        },
        label: '',
        enabledIn: () => true,
      },
    ],
    { hideInPalette: true }
  )

  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = containerRef.current
    if (!c) return

    const item = c.querySelector(`.command-palette-item:nth-child(${selectedIndex + 1})`) as HTMLElement | null
    if (!item) return

    const containerRect = c.getBoundingClientRect()
    const rowRect = item.getBoundingClientRect()
    const isInView = rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom

    if (!isInView) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useEffect(() => {
    setSearchQuery('')
    setSelectedIndex(0)
    setEditingCommand(null)
    setRecordedKeys(null)
    // Focus the search input when dialog opens
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }, [])

  useEffect(() => {
    // Reset selected index when search results change
    setSelectedIndex(0)
  }, [searchQuery])

  // Keyboard recording handler for editing shortcuts
  useEffect(() => {
    if (!editingCommand) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Ignore modifier-only keys
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return

      setRecordedKeys(e)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [editingCommand])

  // Keyboard capture for keymap search mode
  useEffect(() => {
    if (!isSearchingByKeymap) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if editing a shortcut
      if (editingCommand) return

      e.preventDefault()
      e.stopPropagation()

      if (e.metaKey && e.key === 'Escape') {
        setIsSearchingByKeymap(false)
        setSearchQuery('')
        return
      }

      const isModifierKey = ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)

      // Build keymap string
      const parts: string[] = []
      if (e.metaKey) parts.push('⌘')
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (!isModifierKey) parts.push(shortcutKeyString(e.code))

      const keymapStr = parts.join('+')
      setSearchQuery(keymapStr)

      // Keep focus on the search input
      searchInputRef.current?.focus()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isSearchingByKeymap, editingCommand])

  const handleSaveShortcut = (command: string) => {
    if (!recordedKeys) return

    const shortcut: ShortcutCode = {
      code: recordedKeys.code,
      metaKey: recordedKeys.metaKey || undefined,
      ctrlKey: recordedKeys.ctrlKey || undefined,
      altKey: recordedKeys.altKey || undefined,
      shiftKey: recordedKeys.shiftKey || undefined,
    }

    shortcutCustomizationHelpers.setCustomShortcut(command, shortcut)
    setEditingCommand(null)
    setRecordedKeys(null)
  }

  return (
    <Dialog
      title={
        <div className="flex items-center gap-2">
          <KeyboardIcon className="w-5 h-5" />
          Keyboard Shortcuts
        </div>
      }
      onClose={dialogActions.close}
      footer={<Button onClick={dialogActions.close}>Close</Button>}
      className="max-w-2xl"
    >
      {duplicateCommands.size > 0 && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded dark:bg-yellow-900/40 dark:border-yellow-600 flex items-start gap-2">
          <AlertTriangleIcon className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-yellow-800 dark:text-yellow-200">
            {duplicateCommands.size} shortcut{duplicateCommands.size > 1 ? 's have' : ' has'} conflicting keymaps.
            Multiple commands share the same keyboard shortcut, which may cause unexpected behavior.
          </span>
        </div>
      )}
      <div className="mb-4 flex items-center gap-2">
        <input
          ref={searchInputRef}
          type="text"
          placeholder={isSearchingByKeymap ? 'Press keys to search...' : 'Search shortcuts...'}
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className={clsx(
            'flex-1 px-3 py-2 text-sm border rounded focus:outline-none focus:ring-2',
            isSearchingByKeymap
              ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20 focus:ring-blue-500'
              : 'border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 focus:ring-blue-500'
          )}
        />

        <Tooltip content="Search by keymap (⌘+Esc)" placement="left">
          <button
            onClick={() => {
              setIsSearchingByKeymap(!isSearchingByKeymap)
              setSearchQuery('')
            }}
            className={clsx(
              'p-2 rounded border transition-colors h-[34px] w-[34px] flex items-center justify-center',
              isSearchingByKeymap
                ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/40 dark:border-blue-600 dark:text-blue-300'
                : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700'
            )}
          >
            <KeyboardIcon className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>
      <div className="overflow-y-auto max-h-[50vh] h-[50vh]" ref={containerRef}>
        <div className="space-y-1 min-h-full">
          {filteredShortcuts.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {searchQuery.trim() ? 'No shortcuts match your search' : 'No shortcuts registered'}
            </div>
          ) : (
            filteredShortcuts.map((shortcut, index) => {
              const isEditing = editingCommand === shortcut.command
              const hasCustom = shortcutCustomizationHelpers.hasCustomShortcut(shortcut.command)
              const isDuplicate = duplicateCommands.has(shortcut.command)
              const displayShortcut = hasCustom
                ? customShortcuts[shortcut.command]
                : isSequenceShortcut(shortcut.shortcut)
                  ? { sequence: shortcut.shortcut.sequence }
                  : shortcut.shortcut.code

              return (
                <div
                  key={shortcut.command}
                  className={clsx(
                    'flex items-center justify-between py-2 px-3 rounded hover:bg-gray-100 dark:hover:bg-gray-800 command-palette-item group',
                    index === selectedIndex ? 'bg-base-content/10' : '',
                    !isEditing && 'cursor-pointer',
                    isDuplicate && 'bg-yellow-100 dark:bg-yellow-900/30'
                  )}
                  onClick={() => {
                    if (!isEditing) {
                      dialogActions.close()
                      shortcut.shortcut.handler(undefined)
                    }
                  }}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-sm">{shortcut.label}</span>
                    {isDuplicate && (
                      <span title="Conflicting keymap">
                        <AlertTriangleIcon className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1 h-6">
                        <kbd className="px-2 py-1 text-xs font-semibold text-blue-800 bg-blue-100 border border-blue-200 rounded dark:bg-blue-900 dark:text-blue-100 dark:border-blue-700 whitespace-nowrap leading-none">
                          {recordedKeys
                            ? shortcutToString({
                                code: recordedKeys.code,
                                metaKey: recordedKeys.metaKey || undefined,
                                ctrlKey: recordedKeys.ctrlKey || undefined,
                                altKey: recordedKeys.altKey || undefined,
                                shiftKey: recordedKeys.shiftKey || undefined,
                              })
                            : 'Press a key...'}
                        </kbd>
                        <button
                          onClick={() => handleSaveShortcut(shortcut.command)}
                          disabled={!recordedKeys}
                          className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors h-6 w-6 flex items-center justify-center"
                          title="Save"
                        >
                          <svg
                            className="w-3.5 h-3.5 text-green-600 dark:text-green-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setEditingCommand(null)
                            setRecordedKeys(null)
                          }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900 transition-colors h-6 w-6 flex items-center justify-center"
                          title="Cancel"
                        >
                          <XIcon className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative flex items-center gap-2 group h-6">
                        {hasCustom && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              shortcutCustomizationHelpers.removeCustomShortcut(shortcut.command)
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded h-6 w-6 flex items-center justify-center"
                            title="Reset to default"
                          >
                            <RotateCcwIcon className="w-3.5 h-3.5 text-gray-500" />
                          </button>
                        )}
                        <div
                          className="flex items-center gap-2 cursor-pointer h-6"
                          onClick={e => {
                            e.stopPropagation()
                            setEditingCommand(shortcut.command)
                            setRecordedKeys(null)
                          }}
                        >
                          <Edit2Icon className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500" />
                          <div className="flex items-center gap-1 h-6">
                            {/* Show custom shortcut if defined */}
                            {hasCustom && (
                              <>
                                <kbd
                                  className={clsx(
                                    'px-2 py-1 text-xs font-semibold border rounded hover:opacity-80',
                                    'text-blue-800 bg-blue-100 border-blue-200 dark:bg-blue-900 dark:text-blue-100 dark:border-blue-700'
                                  )}
                                >
                                  {typeof displayShortcut === 'object' && 'sequence' in displayShortcut
                                    ? displayShortcut.sequence.join(' ')
                                    : Array.isArray(displayShortcut)
                                      ? displayShortcut.map(shortcutToString).join(' or ')
                                      : shortcutToString(displayShortcut)}
                                </kbd>
                                <span className="text-xs text-gray-400">→</span>
                              </>
                            )}
                            {/* Show original shortcut */}
                            <kbd
                              className={clsx(
                                'px-2 py-1 text-xs font-semibold border rounded hover:opacity-80',
                                hasCustom
                                  ? 'text-gray-500 bg-gray-50 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700 line-through'
                                  : 'text-gray-800 bg-gray-100 border-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600'
                              )}
                            >
                              {isSequenceShortcut(shortcut.defaultShortcut)
                                ? shortcut.defaultShortcut.sequence.join(' ')
                                : Array.isArray(shortcut.defaultShortcut.code)
                                  ? shortcut.defaultShortcut.code.map(shortcutToString).join(' or ')
                                  : shortcutToString(shortcut.defaultShortcut.code)}
                            </kbd>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </Dialog>
  )
}

function shortcutKeyString(key: string) {
  if (key === ' ') return 'Space'
  return key
}

function shortcutToString(shortcut: ShortcutCode): string {
  if (typeof shortcut === 'string') {
    return shortcutKeyString(shortcut)
  }

  const parts: string[] = []
  if (shortcut.metaKey) parts.push('⌘')
  if (shortcut.ctrlKey) parts.push('Ctrl')
  if (shortcut.altKey) parts.push('Alt')
  if (shortcut.shiftKey) parts.push('Shift')
  parts.push(shortcutKeyString(shortcut.code))

  return parts.join('+')
}
