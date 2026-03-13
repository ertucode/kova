import { useMemo } from 'react'
import { Trash2Icon } from 'lucide-react'
import { createEmptyHeaderRow, parseHeaderRows, stringifyHeaderRows } from './folderExplorerUtils'
import type { HeaderRow } from './folderExplorerTypes'

export function HeadersEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rows = useMemo(() => [...parseHeaderRows(value), createEmptyHeaderRow()], [value])

  const updateRow = (id: string, patch: Partial<HeaderRow>) => {
    onChange(stringifyHeaderRows(rows.map(row => (row.id === id ? { ...row, ...patch } : row))))
  }

  const removeRow = (id: string) => {
    onChange(stringifyHeaderRows(rows.filter(row => row.id !== id)))
  }

  return (
    <section className="w-full border-b border-base-content/10">
      <div className="pl-2 py-2 text-sm text-base-content/55">Headers</div>

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
              <tr key={index} className="border-b border-base-content/10 last:border-b-0">
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
                    className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 text-sm border-none outline-none px-0"
                    value={row.key}
                    placeholder="Authorization"
                    onChange={event => updateRow(row.id, { key: event.target.value })}
                  />
                </td>
                <td className="p-0 px-2 align-middle">
                  <input
                    className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 text-sm border-none outline-none px-0"
                    value={row.value}
                    placeholder="Bearer ..."
                    onChange={event => updateRow(row.id, { value: event.target.value })}
                  />
                </td>
                <td className="p-0 px-2 align-middle">
                  <input
                    className="input h-9 w-full rounded-none border-base-content/10 bg-base-100/70 text-sm border-none outline-none px-0"
                    value={row.description}
                    placeholder="Optional note"
                    onChange={event => updateRow(row.id, { description: event.target.value })}
                  />
                </td>
                <td className="p-0 align-middle text-center">
                  {!isCreateRow ? (
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center border-none bg-base-100/70 text-base-content/55 transition hover:bg-base-100 hover:text-base-content"
                      onClick={() => removeRow(row.id)}
                      aria-label="Remove header"
                      title="Remove header"
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
