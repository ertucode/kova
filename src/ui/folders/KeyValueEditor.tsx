import { useEffect, useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import type { KeyValueRow } from '@common/KeyValueRows'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'

type KeyValueEditorProps = {
  label: string | null
  value: string
  onChange: (value: string) => void
  keyPlaceholder: string
  valuePlaceholder: string
  descriptionPlaceholder?: string
}

export function KeyValueEditor({
  label,
  value,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  descriptionPlaceholder = 'Optional note',
}: KeyValueEditorProps) {
  const [rows, setRows] = useState<KeyValueRow[]>(() => buildRows(value, []))

  useEffect(() => {
    setRows(currentRows => buildRows(value, currentRows))
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

  return (
    <section className="w-full border-b border-base-content/10">
      {label ? <div className="pl-2 py-2 text-sm text-base-content/55">{label}</div> : null}

      <div className="overflow-hidden border border-base-content/10 bg-base-100/35">
        <table className="table w-full table-fixed border-collapse text-sm">
          <thead>
            <tr className="border-b border-base-content/10 bg-base-100/70 text-left text-base-content/55">
              <th className="w-8 px-2 py-2 font-medium">On</th>
              <th className="w-[24%] px-2 py-2 font-medium">Key</th>
              <th className="w-[34%] px-2 py-2 font-medium">Value</th>
              <th className="px-2 py-2 font-medium">Description</th>
              <th className="w-8 px-2 py-2 font-medium"></th>
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
                    <input
                      className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-sm border-none outline-none"
                      value={row.key}
                      placeholder={keyPlaceholder}
                      onChange={event => updateRow(row.id, { key: event.target.value })}
                    />
                  </td>
                  <td className="p-0 px-2 align-middle">
                    <input
                      className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-sm border-none outline-none"
                      value={row.value}
                      placeholder={valuePlaceholder}
                      onChange={event => updateRow(row.id, { value: event.target.value })}
                    />
                  </td>
                  <td className="p-0 px-2 align-middle">
                    <input
                      className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 px-0 text-sm border-none outline-none"
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
