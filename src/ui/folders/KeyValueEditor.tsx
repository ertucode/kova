import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { AlertTriangleIcon, CheckIcon, GripVerticalIcon, PencilIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { KeyValueRow } from '@common/KeyValueRows'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { CodeEditor } from './CodeEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'

type KeyValueEditorProps = {
  label: string | null
  value: string
  onChange: (value: string) => void
  keyPlaceholder: string
  valuePlaceholder: string
  descriptionPlaceholder?: string
  valueEditorExtensions?: Extension[]
  valueEditorAsCode?: boolean
  warnOnDuplicate?: boolean
  contentClassName?: string
}

type KeyValueField = 'enabled' | 'key' | 'value' | 'description'

type PendingFocusTarget = {
  rowId: string
  field: KeyValueField
}

export function KeyValueEditor({
  label,
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  descriptionPlaceholder = 'Optional note',
  valueEditorExtensions,
  valueEditorAsCode = false,
  warnOnDuplicate = true,
  contentClassName,
}: KeyValueEditorProps) {
  const [rows, setRows] = useState<KeyValueRow[]>(() => buildRows(value, []))
  const [isBulkEditMode, setIsBulkEditMode] = useState(false)
  const [bulkEditValue, setBulkEditValue] = useState(value)
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null)
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null)
  const lastEmittedValueRef = useRef(value)
  const rootRef = useRef<HTMLElement | null>(null)
  const focusedRowIdRef = useRef<string | null>(null)
  const pendingFocusTargetRef = useRef<PendingFocusTarget | null>(null)
  const duplicateRowIds = getDuplicateRowIds(rows)
  const bulkEditError = isBulkEditMode ? validateBulkEditValue(bulkEditValue) : null
  const populatedRowCount = getRowCountWithoutTrailingCreateRow(rows)

  const commitRows = useCallback(
    (nextRows: KeyValueRow[]) => {
      const normalizedRows = ensureTrailingEmptyRow(stripTrailingCreateRow(nextRows))
      const nextValue = stringifyKeyValueRows(normalizedRows)
      lastEmittedValueRef.current = nextValue
      onChange(nextValue)
      return normalizedRows
    },
    [onChange]
  )

  useEffect(() => {
    if (value !== lastEmittedValueRef.current) {
      setRows(currentRows => buildRows(value, currentRows))
      lastEmittedValueRef.current = value
    }

    if (!isBulkEditMode) {
      setBulkEditValue(value)
    }
  }, [isBulkEditMode, value])

  useEffect(() => {
    const pendingFocusTarget = pendingFocusTargetRef.current
    if (!pendingFocusTarget) {
      return
    }

    const rootElement = rootRef.current
    if (!rootElement) {
      return
    }

    const focusTarget = getFocusableElement(rootElement, pendingFocusTarget.rowId, pendingFocusTarget.field)
    if (!focusTarget) {
      return
    }

    pendingFocusTargetRef.current = null
    focusKeyValueTarget(focusTarget, pendingFocusTarget.field)
  }, [rows])

  const updateRow = useCallback(
    (id: string, patch: Partial<KeyValueRow>) => {
      setRows(currentRows => {
        const nextRows = currentRows.map(row => (row.id === id ? { ...row, ...patch } : row))
        return commitRows(nextRows)
      })
    },
    [commitRows]
  )

  const insertRowAt = useCallback(
    (index: number, row?: KeyValueRow, focusField: KeyValueField = 'key') => {
      setRows(currentRows => {
        const nextRows = stripTrailingCreateRow(currentRows)
        const safeIndex = Math.max(0, Math.min(index, nextRows.length))
        const nextRow = row ?? createEmptyKeyValueRow()
        pendingFocusTargetRef.current = { rowId: nextRow.id, field: focusField }
        nextRows.splice(safeIndex, 0, nextRow)
        return commitRows(nextRows)
      })
    },
    [commitRows]
  )

  const duplicateRow = useCallback(
    (id: string) => {
      setRows(currentRows => {
        const baseRows = stripTrailingCreateRow(currentRows)
        const sourceIndex = baseRows.findIndex(row => row.id === id)
        if (sourceIndex < 0) {
          return currentRows
        }

        const sourceRow = baseRows[sourceIndex]
        if (!hasKeyValueContent(sourceRow)) {
          return currentRows
        }

        const duplicatedRow = { ...sourceRow, id: crypto.randomUUID() }
        pendingFocusTargetRef.current = { rowId: duplicatedRow.id, field: 'key' }
        baseRows.splice(sourceIndex + 1, 0, duplicatedRow)
        return commitRows(baseRows)
      })
    },
    [commitRows]
  )

  const moveRow = useCallback(
    (id: string, targetIndex: number) => {
      setRows(currentRows => {
        const baseRows = stripTrailingCreateRow(currentRows)
        const sourceIndex = baseRows.findIndex(row => row.id === id)
        if (sourceIndex < 0) {
          return currentRows
        }

        const boundedTargetIndex = Math.max(0, Math.min(targetIndex, baseRows.length))
        const [movedRow] = baseRows.splice(sourceIndex, 1)
        const nextTargetIndex = sourceIndex < boundedTargetIndex ? boundedTargetIndex - 1 : boundedTargetIndex
        baseRows.splice(nextTargetIndex, 0, movedRow)
        return commitRows(baseRows)
      })
    },
    [commitRows]
  )

  const removeRow = (id: string, focusField: KeyValueField = 'key') => {
    setRows(currentRows => {
      const sourceIndex = currentRows.findIndex(row => row.id === id)
      const nextRows = currentRows.filter(row => row.id !== id)
      const committedRows = commitRows(nextRows)
      if (sourceIndex >= 0) {
        const fallbackRow = committedRows[Math.min(sourceIndex, committedRows.length - 1)]
        if (fallbackRow) {
          pendingFocusTargetRef.current = { rowId: fallbackRow.id, field: focusField }
        }
      }
      return committedRows
    })
  }

  const setFocusedRowId = useCallback((rowId: string | null) => {
    focusedRowIdRef.current = rowId
  }, [])

  const handleDuplicateShortcut = useCallback(() => {
    const focusedRowId = focusedRowIdRef.current
    if (!focusedRowId) {
      return false
    }

    duplicateRow(focusedRowId)
    return true
  }, [duplicateRow])

  const handleRemoveShortcut = useCallback(() => {
    const focusedRowId = focusedRowIdRef.current
    if (!focusedRowId) {
      return false
    }

    const rowToRemove = rows.find(row => row.id === focusedRowId)
    if (!rowToRemove || !hasKeyValueContent(rowToRemove)) {
      return false
    }

    removeRow(focusedRowId)
    return true
  }, [rows])

  const duplicateRowKeyBinding = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-d',
            run: () => handleDuplicateShortcut(),
          },
          {
            key: 'Mod-Backspace',
            run: () => handleRemoveShortcut(),
          },
        ])
      ),
    [handleDuplicateShortcut, handleRemoveShortcut]
  )

  const resolvedValueEditorExtensions = useMemo(
    () => [...(valueEditorExtensions ?? []), duplicateRowKeyBinding],
    [duplicateRowKeyBinding, valueEditorExtensions]
  )

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      const rowElement = target.closest<HTMLElement>('[data-key-value-row-id]')
      const rowId = rowElement?.dataset.keyValueRowId
      if (!rowId) {
        return
      }

      const field = getFieldFromTarget(target)
      if (!field) {
        return
      }

      const normalizedKey = event.key.toLowerCase()

      if (event.key === 'Enter') {
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
          return
        }

        const rowIndex = rows.findIndex(row => row.id === rowId)
        if (rowIndex < 0) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setFocusedRowId(rowId)
        insertRowAt(rowIndex + 1, undefined, 'key')
        return
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return
      }

      if (normalizedKey === 'd') {
        event.preventDefault()
        event.stopPropagation()
        setFocusedRowId(rowId)
        duplicateRow(rowId)
        return
      }

      if (normalizedKey === 'h' || normalizedKey === 'j' || normalizedKey === 'k' || normalizedKey === 'l') {
        const nextFocusTarget = getNextFocusTarget(rows, rowId, field, normalizedKey)
        if (!nextFocusTarget) {
          return
        }

        const rootElement = rootRef.current
        if (!rootElement) {
          return
        }

        const focusTarget = getFocusableElement(rootElement, nextFocusTarget.rowId, nextFocusTarget.field)
        if (!focusTarget) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        setFocusedRowId(nextFocusTarget.rowId)
        focusKeyValueTarget(focusTarget, nextFocusTarget.field)
        return
      }

      if (event.key !== 'Backspace') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setFocusedRowId(rowId)
      removeRow(rowId, field)
    },
    [duplicateRow, insertRowAt, removeRow, rows, setFocusedRowId]
  )

  const renderInsertGap = (insertIndex: number) => {
    const isActiveDropTarget = draggedRowId !== null && dropInsertIndex === insertIndex

    return (
      <tr key={`gap-${insertIndex}`} className="group/gap h-0">
        <td colSpan={5} className="relative p-0 align-middle overflow-visible">
          <button
            type="button"
            className={[
              'absolute left-7 top-0 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-base-content/12 bg-base-100 text-base-content/55 transition',
              draggedRowId ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover/gap:opacity-100',
              draggedRowId
                ? 'hover:border-primary/35 hover:text-primary'
                : 'hover:border-base-content/25 hover:text-base-content',
            ].join(' ')}
            onClick={() => insertRowAt(insertIndex)}
            aria-label="Insert row"
            title="Insert row"
          >
            <PlusIcon className="size-3" />
          </button>
          <button
            type="button"
            className="absolute inset-x-0 top-0 block h-px w-full cursor-pointer"
            onClick={() => insertRowAt(insertIndex)}
            onDragOver={event => {
              if (!draggedRowId) {
                return
              }

              event.preventDefault()
              setDropInsertIndex(insertIndex)
            }}
            onDrop={event => {
              if (!draggedRowId) {
                return
              }

              event.preventDefault()
              moveRow(draggedRowId, insertIndex)
              setDraggedRowId(null)
              setDropInsertIndex(null)
            }}
            aria-label="Insert row here"
            title="Insert row here"
          >
            <span
              className={[
                'block w-full bg-transparent transition-all',
                isActiveDropTarget ? 'h-px bg-transparent' : 'h-px group-hover/gap:bg-base-content/30',
              ].join(' ')}
            />
          </button>
        </td>
      </tr>
    )
  }

  const updateDropInsertIndexFromRow = useCallback(
    (event: ReactDragEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (!draggedRowId) {
        return
      }

      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
      const nextInsertIndex = ratio < 0.5 ? rowIndex : rowIndex + 1
      setDropInsertIndex(nextInsertIndex)
    },
    [draggedRowId]
  )

  const commitDroppedRow = useCallback(() => {
    if (!draggedRowId || dropInsertIndex === null) {
      return
    }

    moveRow(draggedRowId, dropInsertIndex)
    setDraggedRowId(null)
    setDropInsertIndex(null)
  }, [draggedRowId, dropInsertIndex, moveRow])

  const openBulkEdit = () => {
    setBulkEditValue(value)
    setIsBulkEditMode(true)
  }

  const cancelBulkEdit = () => {
    setBulkEditValue(value)
    setIsBulkEditMode(false)
  }

  const applyBulkEdit = () => {
    if (bulkEditError) {
      return
    }

    const nextValue = normalizeBulkEditValue(bulkEditValue)
    lastEmittedValueRef.current = nextValue
    onChange(nextValue)
    setIsBulkEditMode(false)
  }

  return (
    <section ref={rootRef} className="w-full border-b border-base-content/10" onKeyDownCapture={handleKeyDownCapture}>
      {label ? <DetailsSectionHeader title={label} /> : null}

      <div
        className={['overflow-hidden border border-base-content/10 bg-base-100/35', contentClassName]
          .filter(Boolean)
          .join(' ')}
      >
        {isBulkEditMode ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-base-content/10 bg-base-100/70 px-3 py-2">
              <div className="text-[0.78rem] font-medium text-base-content/65">
                Bulk edit one row per line: `key:value // description`
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex size-8 items-center justify-center text-base-content/55 transition hover:bg-base-100 hover:text-base-content disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={applyBulkEdit}
                  disabled={Boolean(bulkEditError)}
                  aria-label="Apply bulk edits"
                  title="Apply bulk edits"
                >
                  <CheckIcon className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex size-8 items-center justify-center text-base-content/55 transition hover:bg-base-100 hover:text-base-content"
                  onClick={cancelBulkEdit}
                  aria-label="Cancel bulk edits"
                  title="Cancel bulk edits"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            </div>

            <CodeEditor
              value={bulkEditValue}
              language="plain"
              size="small"
              minHeightClassName="min-h-52"
              className="border-0"
              placeholder={`${keyPlaceholder}:${valuePlaceholder}`}
              extensions={valueEditorExtensions}
              onChange={setBulkEditValue}
            />

            {bulkEditError ? (
              <div className="border-t border-error/20 bg-error/8 px-3 py-2 text-[0.78rem] text-error">
                {bulkEditError}
              </div>
            ) : null}
          </div>
        ) : (
          <table className="table w-full table-fixed border-collapse text-[0.78rem]">
            <thead>
              <tr className="border-b border-base-content/10 bg-base-100/70 text-left text-base-content/55">
                <th className="w-14 px-2 py-2 font-medium">On</th>
                <th className="w-[24%] px-2 py-2 font-medium">Key</th>
                <th className="w-[34%] px-2 py-2 font-medium">Value</th>
                <th className="px-2 py-2 font-medium">Description</th>
                <th className="w-8 px-0 py-2 font-medium text-center">
                  <button
                    type="button"
                    className="mx-auto flex size-7 items-center justify-center text-base-content/55 transition hover:bg-base-100 hover:text-base-content"
                    onClick={openBulkEdit}
                    aria-label="Bulk edit rows"
                    title="Bulk edit rows"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {populatedRowCount > 0 ? renderInsertGap(0) : null}
              {rows.map((row, index) => {
                const isCreateRow = index === rows.length - 1
                const isDragged = draggedRowId === row.id
                const showInsertGapBefore = index > 0 && index <= populatedRowCount
                const showDropBefore = !isCreateRow && draggedRowId !== null && dropInsertIndex === index
                const showDropAfter = !isCreateRow && draggedRowId !== null && dropInsertIndex === index + 1

                return (
                  <Fragment key={row.id}>
                    {showInsertGapBefore ? renderInsertGap(index) : null}
                    <tr
                      className={[
                        'border-b border-base-content/10 last:border-b-0',
                        isDragged ? 'opacity-45' : '',
                      ].join(' ')}
                      data-key-value-row-id={row.id}
                      onDragOver={event => {
                        if (isCreateRow) {
                          return
                        }

                        updateDropInsertIndexFromRow(event, index)
                      }}
                      onDrop={event => {
                        if (isCreateRow) {
                          return
                        }

                        event.preventDefault()
                        commitDroppedRow()
                      }}
                    >
                      <td className="relative p-0 align-middle text-center">
                        {showDropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-[-2px] h-[1px] bg-primary" />
                        ) : null}
                        {showDropAfter ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[1px] bg-primary" />
                        ) : null}
                        {!isCreateRow ? (
                          <div className="flex items-center justify-center gap-0.5 px-1">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm rounded-none border-none"
                              data-key-value-field="enabled"
                              checked={row.enabled}
                              onFocus={() => setFocusedRowId(row.id)}
                              onChange={event => updateRow(row.id, { enabled: event.target.checked })}
                            />
                            <div
                              className="flex size-8 cursor-grab items-center justify-center text-base-content/45 transition hover:text-base-content active:cursor-grabbing"
                              draggable
                              onDragStart={event => {
                                setDraggedRowId(row.id)
                                setDropInsertIndex(index)
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.dropEffect = 'move'
                                event.dataTransfer.setData('text/plain', row.id)
                              }}
                              onDragEnd={() => {
                                setDraggedRowId(null)
                                setDropInsertIndex(null)
                              }}
                              aria-label="Reorder row"
                              title="Reorder row"
                            >
                              <GripVerticalIcon className="size-4" />
                            </div>
                          </div>
                        ) : null}
                      </td>
                      <td className="relative p-0 px-2 align-middle">
                        {showDropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-[-2px] h-[1px] bg-primary" />
                        ) : null}
                        {showDropAfter ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[1px] bg-primary" />
                        ) : null}
                        <div className="flex items-center gap-1">
                          <input
                            className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                            data-key-value-field="key"
                            data-key-value-focus-target="true"
                            value={row.key}
                            placeholder={keyPlaceholder}
                            onFocus={() => setFocusedRowId(row.id)}
                            onChange={event => updateRow(row.id, { key: event.target.value })}
                          />
                          {warnOnDuplicate && !isCreateRow && duplicateRowIds.has(row.id) ? (
                            <div
                              className="flex size-4 shrink-0 items-center justify-center text-warning"
                              title="This key is overridden later by another enabled row."
                              aria-label="Duplicate key overridden later"
                            >
                              <AlertTriangleIcon className="size-3.5" />
                            </div>
                          ) : (
                            <div className="size-4 shrink-0" />
                          )}
                        </div>
                      </td>
                      <td className="relative p-0 px-2 align-middle">
                        {showDropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-[-2px] h-[1px] bg-primary" />
                        ) : null}
                        {showDropAfter ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[1px] bg-primary" />
                        ) : null}
                        {valueEditorAsCode ? (
                          <div data-key-value-field="value" data-key-value-row-id={row.id} onFocusCapture={() => setFocusedRowId(row.id)}>
                            <CodeEditor
                              value={row.value}
                              language="plain"
                              singleLine
                              compact
                              size="small"
                              hideFocusOutline
                              className="h-9 border-0 bg-transparent"
                              extensions={resolvedValueEditorExtensions}
                              placeholder={valuePlaceholder}
                              onChange={nextValue => updateRow(row.id, { value: nextValue })}
                            />
                          </div>
                        ) : (
                          <input
                            className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                            data-key-value-field="value"
                            data-key-value-focus-target="true"
                            value={row.value}
                            placeholder={valuePlaceholder}
                            onFocus={() => setFocusedRowId(row.id)}
                            onChange={event => updateRow(row.id, { value: event.target.value })}
                          />
                        )}
                      </td>
                      <td className="relative p-0 px-2 align-middle">
                        {showDropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-[-2px] h-[1px] bg-primary" />
                        ) : null}
                        {showDropAfter ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[1px] bg-primary" />
                        ) : null}
                        <input
                          className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                          data-key-value-field="description"
                          data-key-value-focus-target="true"
                          value={row.description}
                          placeholder={descriptionPlaceholder}
                          onFocus={() => setFocusedRowId(row.id)}
                          onChange={event => updateRow(row.id, { description: event.target.value })}
                        />
                      </td>
                      <td className="relative p-0 align-middle text-center">
                        {showDropBefore ? (
                          <span className="pointer-events-none absolute inset-x-0 top-[-2px] h-[1px] bg-primary" />
                        ) : null}
                        {showDropAfter ? (
                          <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] h-[1px] bg-primary" />
                        ) : null}
                        {!isCreateRow ? (
                          <button
                            type="button"
                            className="flex size-8 items-center justify-center border-none bg-base-100/70 text-base-content/55 transition hover:bg-base-100 hover:text-base-content"
                            onClick={() => removeRow(row.id)}
                            aria-label="Remove row"
                            title="Remove row"
                          >
                            <Trash2Icon className="size-4" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

function stripTrailingCreateRow(rows: KeyValueRow[]) {
  const lastRow = rows[rows.length - 1]
  if (lastRow && !hasKeyValueContent(lastRow)) {
    return rows.slice(0, -1)
  }

  return [...rows]
}

function getRowCountWithoutTrailingCreateRow(rows: KeyValueRow[]) {
  return stripTrailingCreateRow(rows).length
}

function buildRows(value: string, currentRows: KeyValueRow[]) {
  const parsedRows = parseKeyValueRows(value)
  const existingRows = currentRows.filter(row => row !== currentRows[currentRows.length - 1])
  const nextRows = parsedRows.map((row, index) => ({
    ...row,
    id: existingRows[index]?.id ?? row.id,
  }))

  return ensureTrailingEmptyRow(nextRows)
}

function ensureTrailingEmptyRow(rows: KeyValueRow[]) {
  if (rows.length === 0 || hasKeyValueContent(rows[rows.length - 1])) {
    return [...rows, createEmptyKeyValueRow()]
  }

  return rows
}

function hasKeyValueContent(row: KeyValueRow) {
  return row.key.trim() !== '' || row.value.trim() !== '' || row.description.trim() !== ''
}

function getDuplicateRowIds(rows: KeyValueRow[]) {
  const lastEnabledIndexByKey = new Map<string, number>()

  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (!row.enabled || !key || !hasKeyValueContent(row)) {
      return
    }

    lastEnabledIndexByKey.set(key, index)
  })

  const duplicateIds = new Set<string>()

  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (!row.enabled || !key || !hasKeyValueContent(row)) {
      return
    }

    if (lastEnabledIndexByKey.get(key) !== index) {
      duplicateIds.add(row.id)
    }
  })

  return duplicateIds
}

function validateBulkEditValue(value: string) {
  const lines = value.split('\n')

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const content = trimmed.startsWith('//') ? trimmed.slice(2).trim() : trimmed
    const entry = content.includes(' // ') ? content.slice(0, content.indexOf(' // ')) : content
    if (!entry.includes(':')) {
      return `Line ${index + 1} is invalid. Use key:value or //key:value format.`
    }
  }

  return null
}

function normalizeBulkEditValue(value: string) {
  return value
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}

function getFieldFromTarget(target: HTMLElement): KeyValueField | null {
  const fieldElement = target.closest<HTMLElement>('[data-key-value-field]')
  const field = fieldElement?.dataset.keyValueField
  return isKeyValueField(field) ? field : null
}

function isKeyValueField(field: string | undefined): field is KeyValueField {
  return field === 'enabled' || field === 'key' || field === 'value' || field === 'description'
}

function getFocusableElement(rootElement: HTMLElement, rowId: string, field: KeyValueField) {
  const fieldElement = rootElement.querySelector<HTMLElement>(
    `[data-key-value-row-id="${rowId}"] [data-key-value-field="${field}"]`
  )
  if (!fieldElement) {
    return null
  }

  if (fieldElement.matches('input, textarea, button, [contenteditable="true"]')) {
    return fieldElement
  }

  return fieldElement.querySelector<HTMLElement>(
    '[data-key-value-focus-target="true"], input, textarea, button, [contenteditable="true"], .cm-content'
  )
}

function getNextFocusTarget(
  rows: KeyValueRow[],
  rowId: string,
  field: KeyValueField,
  direction: 'h' | 'j' | 'k' | 'l'
): PendingFocusTarget | null {
  const rowIndex = rows.findIndex(row => row.id === rowId)
  if (rowIndex < 0) {
    return null
  }

  const fields: KeyValueField[] = ['enabled', 'key', 'value', 'description']
  const fieldIndex = fields.indexOf(field)
  if (fieldIndex < 0) {
    return null
  }

  if (direction === 'h') {
    const nextField = fields[fieldIndex - 1]
    return nextField ? { rowId, field: nextField } : null
  }

  if (direction === 'l') {
    const nextField = fields[fieldIndex + 1]
    return nextField ? { rowId, field: nextField } : null
  }

  if (direction === 'k') {
    const previousRow = rows[rowIndex - 1]
    return previousRow ? { rowId: previousRow.id, field } : null
  }

  const nextRow = rows[rowIndex + 1]
  return nextRow ? { rowId: nextRow.id, field } : null
}

function focusKeyValueTarget(target: HTMLElement, field: KeyValueField) {
  target.focus()

  if (field === 'enabled') {
    return
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const caretPosition = target.value.length
    target.setSelectionRange(caretPosition, caretPosition)
    return
  }

  if (target.isContentEditable) {
    const selection = window.getSelection()
    if (!selection) {
      return
    }

    const range = document.createRange()
    range.selectNodeContents(target)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}
