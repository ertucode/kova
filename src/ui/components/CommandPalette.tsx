import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Typescript } from '@common/Typescript'
import Fuse from 'fuse.js'
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import {
  changeCommandPaletteOption,
  commandPaletteConfigs,
  executeCommandPaletteTrigger,
  getCommandPaletteOptions,
  type CommandPaletteInputConfig,
  type CommandPaletteNestedConfig,
  type CommandPaletteOption,
  type CommandPaletteSelectionConfig,
} from '@/global/appSettingsConfig'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { toast } from '@/lib/components/toast'
import { clsx } from '@/lib/functions/clsx'

export function CommandPalette() {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [optionsByConfigId, setOptionsByConfigId] = useState<
    Record<string, readonly CommandPaletteOption<string | boolean>[]>
  >(() =>
    Object.fromEntries(
      commandPaletteConfigs
        .filter(
          (config): config is CommandPaletteSelectionConfig => config.type === 'options' || config.type === 'boolean'
        )
        .map(config => [config.id, getCommandPaletteOptions(config)])
    )
  )
  const [optionLoadErrors, setOptionLoadErrors] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const rootNavigationStateRef = useRef({ query: '', selectedIndex: 0, scrollTop: 0 })
  const scrollTopToRestoreRef = useRef<number | null>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const activeConfig = commandPaletteConfigs.find(
    (config): config is CommandPaletteNestedConfig => config.type !== 'trigger' && config.id === activeConfigId
  )
  const activeSelectionConfig = commandPaletteConfigs.find(
    (config): config is CommandPaletteSelectionConfig =>
      (config.type === 'options' || config.type === 'boolean') && config.id === activeConfigId
  )
  const activeInputConfig: CommandPaletteInputConfig | undefined =
    activeConfig?.type === 'input' ? activeConfig : undefined
  const searchableConfigs = commandPaletteConfigs.map(config => ({
    config,
    optionLabels:
      config.type === 'options' || config.type === 'boolean'
        ? optionsByConfigId[config.id]?.map(option => option.label)
        : [],
  }))
  const configSearch = new Fuse(searchableConfigs, {
    keys: ['config.label', 'config.description', 'optionLabels'],
    threshold: 0.4,
    ignoreLocation: true,
  })
  const filteredConfigs = normalizedQuery
    ? configSearch.search(normalizedQuery).map(result => result.item.config)
    : commandPaletteConfigs
  const activeOptions = activeSelectionConfig
    ? (optionsByConfigId[activeSelectionConfig.id] ?? getCommandPaletteOptions(activeSelectionConfig))
    : []
  const optionSearch = new Fuse(activeOptions, {
    keys: ['label'],
    threshold: 0.4,
    ignoreLocation: true,
  })
  const filteredOptions = activeSelectionConfig
    ? normalizedQuery
      ? optionSearch.search(normalizedQuery).map(result => result.item)
      : activeOptions
    : []
  const resultCount = activeSelectionConfig ? filteredOptions.length : filteredConfigs.length

  useLayoutEffect(() => {
    if (!activeSelectionConfig) {
      return
    }

    const currentValueIndex = filteredOptions.findIndex(option => option.value === activeSelectionConfig.getValue())
    setSelectedIndex(currentValueIndex >= 0 ? currentValueIndex : 0)
  }, [activeSelectionConfig, normalizedQuery, optionsByConfigId])

  useLayoutEffect(() => {
    if (activeConfigId !== null || scrollTopToRestoreRef.current === null || !resultsRef.current) {
      return
    }

    resultsRef.current.scrollTop = scrollTopToRestoreRef.current
    scrollTopToRestoreRef.current = null
  }, [activeConfigId])

  useEffect(() => {
    inputRef.current?.focus()

    let cancelled = false
    for (const config of commandPaletteConfigs) {
      if (config.type !== 'options' || !config.loadOptions) {
        continue
      }

      void config.loadOptions().then(options => {
        if (!cancelled) {
          setOptionsByConfigId(current => ({ ...current, [config.id]: options }))
        }
      }).catch(error => {
        if (!cancelled) {
          setOptionLoadErrors(current => ({
            ...current,
            [config.id]: error instanceof Error ? error.message : String(error),
          }))
        }
      })
    }

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const container = resultsRef.current
    const selectedOption = container?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    if (!container || !selectedOption) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const optionRect = selectedOption.getBoundingClientRect()
    if (optionRect.top < containerRect.top || optionRect.bottom > containerRect.bottom) {
      selectedOption.scrollIntoView({ block: 'nearest' })
    }
  }, [activeConfigId, normalizedQuery, selectedIndex])

  useEffect(() => {
    if (!activeInputConfig) {
      inputRef.current?.focus()
    }
  }, [activeInputConfig])

  const showCommands = () => {
    const rootNavigationState = rootNavigationStateRef.current
    scrollTopToRestoreRef.current = rootNavigationState.scrollTop
    setActiveConfigId(null)
    setInputValue('')
    setInputError(null)
    setQuery(rootNavigationState.query)
    setSelectedIndex(rootNavigationState.selectedIndex)
    inputRef.current?.focus()
  }

  const selectResult = (index: number) => {
    if (activeSelectionConfig) {
      const option = filteredOptions[index]
      if (!option) {
        return
      }

      void Promise.resolve(changeCommandPaletteOption(activeSelectionConfig, option.value)).catch(error => {
        toast.show({
          severity: 'error',
          title: `${activeSelectionConfig.label} failed`,
          message: error instanceof Error ? error.message : String(error),
        })
      })
      dialogActions.close()
      return
    }

    const config = filteredConfigs[index]
    if (!config) {
      return
    }

    switch (config.type) {
      case 'options':
      case 'boolean':
        rootNavigationStateRef.current = {
          query,
          selectedIndex: index,
          scrollTop: resultsRef.current?.scrollTop ?? 0,
        }
        setActiveConfigId(config.id)
        if (
          normalizedQuery &&
          new Fuse(optionsByConfigId[config.id] ?? getCommandPaletteOptions(config), {
            keys: ['label'],
            threshold: 0.4,
            ignoreLocation: true,
          }).search(normalizedQuery).length === 0
        ) {
          setQuery('')
        }
        setSelectedIndex(0)
        return
      case 'input':
        rootNavigationStateRef.current = {
          query,
          selectedIndex: index,
          scrollTop: resultsRef.current?.scrollTop ?? 0,
        }
        setActiveConfigId(config.id)
        setInputValue(config.getValue())
        setInputError(null)
        setQuery('')
        return
      case 'trigger':
        dialogActions.close()
        void executeCommandPaletteTrigger(config).catch(error => {
          toast.show({
            severity: 'error',
            title: `${config.label} failed`,
            message: error instanceof Error ? error.message : String(error),
          })
        })
        return
      default:
        return Typescript.assertUnreachable(config)
    }
  }

  const submitInput = () => {
    if (!activeInputConfig) {
      return
    }

    const validationError = activeInputConfig.validate?.(inputValue) ?? null
    if (validationError) {
      setInputError(validationError)
      return
    }

    void Promise.resolve(activeInputConfig.onChange(inputValue)).catch(error => {
      toast.show({
        severity: 'error',
        title: `${activeInputConfig.label} failed`,
        message: error instanceof Error ? error.message : String(error),
      })
    })
    dialogActions.close()
  }

  return (
    <Dialog
      onClose={dialogActions.close}
      className="absolute top-[12vh] w-[calc(100vw-2rem)] max-w-2xl gap-0 overflow-hidden border border-base-content/15 bg-base-100 p-0 shadow-2xl"
      bodyClassName="overflow-hidden"
    >
      <div className="flex items-center gap-3 border-b border-base-content/10 px-4">
        {activeConfig ? (
          <button
            type="button"
            onClick={showCommands}
            className="-ml-2 p-2 text-base-content/50 hover:bg-base-content/10 hover:text-base-content"
            aria-label="Back to commands"
          >
            <ChevronLeftIcon className="size-4" />
          </button>
        ) : (
          <SearchIcon className="size-4 shrink-0 text-base-content/45" aria-hidden="true" />
        )}
        {activeInputConfig ? (
          <div className="flex h-12 min-w-0 flex-1 items-center text-sm font-medium">{activeInputConfig.label}</div>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setSelectedIndex(index => (resultCount === 0 ? 0 : (index + 1) % resultCount))
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setSelectedIndex(index => (resultCount === 0 ? 0 : (index - 1 + resultCount) % resultCount))
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                selectResult(selectedIndex)
                return
              }

              if (event.key === 'Escape' && activeSelectionConfig) {
                event.preventDefault()
                event.stopPropagation()
                showCommands()
                return
              }

              if (event.key === 'Backspace' && activeSelectionConfig && query === '') {
                event.preventDefault()
                showCommands()
              }
            }}
            placeholder={
              activeSelectionConfig ? `Search ${activeSelectionConfig.label.toLowerCase()} options` : 'Type a command'
            }
            aria-label="Search commands"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/35"
          />
        )}
        <kbd className="border border-base-content/15 bg-base-content/5 px-1.5 py-0.5 text-[10px] text-base-content/45">
          esc
        </kbd>
      </div>

      {activeInputConfig ? (
        <form
          className="space-y-3 p-4"
          onSubmit={event => {
            event.preventDefault()
            submitInput()
          }}
        >
          <p className="text-xs text-base-content/60">{activeInputConfig.description}</p>
          {activeInputConfig.textArea ? (
            <textarea
              autoFocus
              value={inputValue}
              onChange={event => {
                setInputValue(event.target.value)
                setInputError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  showCommands()
                  return
                }

                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  submitInput()
                }
              }}
              placeholder={activeInputConfig.placeholder}
              spellCheck={false}
              className="textarea min-h-36 w-full rounded-lg border-base-content/15 bg-base-content/5 font-mono text-sm leading-6"
              aria-label={activeInputConfig.label}
            />
          ) : (
            <input
              autoFocus
              type={activeInputConfig.inputType ?? 'text'}
              value={inputValue}
              onChange={event => {
                setInputValue(event.target.value)
                setInputError(null)
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  showCommands()
                }
              }}
              placeholder={activeInputConfig.placeholder}
              min={activeInputConfig.min}
              max={activeInputConfig.max}
              step={activeInputConfig.step}
              className="input h-11 w-full rounded-lg border-base-content/15 bg-base-content/5"
              aria-label={activeInputConfig.label}
            />
          )}
          {inputError ? <p className="text-xs text-error">{inputError}</p> : null}
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary btn-sm rounded-lg">
              Apply
            </button>
          </div>
        </form>
      ) : (
        <div
          ref={resultsRef}
          className="max-h-[min(420px,60vh)] overflow-y-auto px-2 py-3"
          role="listbox"
          aria-label="Commands"
        >
        {resultCount === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-base-content/45">No matching commands</div>
        ) : activeSelectionConfig ? (
          <>
            {filteredOptions.map((option, index) => (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                  index === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-content/10'
                )}
                onMouseMove={() => setSelectedIndex(index)}
                onClick={() => selectResult(index)}
              >
                <span className="flex-1">{option.label}</span>
                {option.value === activeSelectionConfig.getValue() ? (
                  <CheckIcon className="size-4" aria-label="Current value" />
                ) : null}
              </button>
            ))}
            {optionLoadErrors[activeSelectionConfig.id] ? (
              <div className="px-3 py-2 text-xs text-error">
                Failed to load options: {optionLoadErrors[activeSelectionConfig.id]}
              </div>
            ) : null}
          </>
        ) : (
          filteredConfigs.map((config, index) => (
            <button
              key={config.id}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                index === selectedIndex ? 'bg-primary text-primary-content' : 'hover:bg-base-content/10'
              )}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => selectResult(index)}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{config.label}</span>
                <span className={clsx('mt-0.5 block text-xs', index === selectedIndex ? 'opacity-70' : 'text-base-content/50')}>
                  {config.description}
                </span>
              </span>
              {config.type !== 'trigger' ? (
                <ChevronRightIcon className="size-4 shrink-0 opacity-60" aria-hidden="true" />
              ) : null}
            </button>
          ))
        )}
        </div>
      )}
    </Dialog>
  )
}
