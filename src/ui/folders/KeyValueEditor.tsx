import { useEffect, useState } from 'react'
import { AlertTriangleIcon, CheckIcon, PencilIcon, Trash2Icon, XIcon } from 'lucide-react'
import type { Extension } from '@codemirror/state'
import type { KeyValueRow } from '@common/KeyValueRows'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { CodeEditor } from './CodeEditor'

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
}: KeyValueEditorProps) {
  const [rows, setRows] = useState<KeyValueRow[]>(() => buildRows(value, []))
  const [isBulkEditMode, setIsBulkEditMode] = useState(false)
  const [bulkEditValue, setBulkEditValue] = useState(value)
  const duplicateRowIds = getDuplicateRowIds(rows)
  const bulkEditError = isBulkEditMode ? validateBulkEditValue(bulkEditValue) : null

  useEffect(() => {
    setRows(currentRows => buildRows(value, currentRows))
    if (!isBulkEditMode) {
      setBulkEditValue(value)
    }
  }, [value])

  const updateRow = (id: string, patch: Partial<KeyValueRow>) => {
    setRows(currentRows => {
      const nextRows = currentRows.map(row => (row.id === id ? { ...row, ...patch } : row))
      const lastRow = nextRows[nextRows.length - 1]

      if (lastRow && hasKeyValueContent(lastRow)) {
        nextRows.push(createEmptyKeyValueRow())
      }

      onChange(stringifyKeyValueRows(nextRows))
      return nextRows
    })
  }

  const removeRow = (id: string) => {
    setRows(currentRows => {
      const nextRows = ensureTrailingEmptyRow(currentRows.filter(row => row.id !== id))
      onChange(stringifyKeyValueRows(nextRows))
      return nextRows
    })
  }

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

    onChange(normalizeBulkEditValue(bulkEditValue))
    setIsBulkEditMode(false)
  }

  return (
    <section className="w-full border-b border-base-content/10">
      {label ? <div className="pl-2 py-2 text-[0.78rem] font-semibold text-base-content">{label}</div> : null}

      <div className="overflow-hidden border border-base-content/10 bg-base-100/35">
        {isBulkEditMode ? (
          <div className="flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-base-content/10 bg-base-100/70 px-3 py-2">
              <div className="text-[0.78rem] font-medium text-base-content/65">Bulk edit one row per line: `key:value // description`</div>
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

            {bulkEditError ? <div className="border-t border-error/20 bg-error/8 px-3 py-2 text-[0.78rem] text-error">{bulkEditError}</div> : null}
          </div>
        ) : (
          <table className="table w-full table-fixed border-collapse text-[0.78rem]">
            <thead>
              <tr className="border-b border-base-content/10 bg-base-100/70 text-left text-base-content/55">
                <th className="w-8 px-2 py-2 font-medium">On</th>
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
              {rows.map((row, index) => {
                const isCreateRow = index === rows.length - 1

                return (
                  <tr key={row.id} className="border-b border-base-content/10 last:border-b-0">
                    <td className="p-0 align-middle text-center">
                      {!isCreateRow ? (
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm rounded-none border-none"
                          checked={row.enabled}
                          onChange={event => updateRow(row.id, { enabled: event.target.checked })}
                        />
                      ) : null}
                    </td>
                    <td className="p-0 px-2 align-middle">
                      <div className="flex items-center gap-1">
                        <input
                          className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                          value={row.key}
                          placeholder={keyPlaceholder}
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
                    <td className="p-0 px-2 align-middle">
                      {valueEditorAsCode ? (
                        <CodeEditor
                          value={row.value}
                          language="plain"
                          singleLine
                          compact
                          size="small"
                          hideFocusOutline
                          className="h-9 border-0 bg-transparent"
                          extensions={valueEditorExtensions}
                          placeholder={valuePlaceholder}
                          onChange={nextValue => updateRow(row.id, { value: nextValue })}
                        />
                      ) : (
                        <input
                          className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                          value={row.value}
                          placeholder={valuePlaceholder}
                          onChange={event => updateRow(row.id, { value: event.target.value })}
                        />
                      )}
                    </td>
                    <td className="p-0 px-2 align-middle">
                      <input
                        className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-[0.78rem] border-none outline-none"
                        value={row.description}
                        placeholder={descriptionPlaceholder}
                        onChange={event => updateRow(row.id, { description: event.target.value })}
                      />
                    </td>
                    <td className="p-0 align-middle text-center">
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
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
