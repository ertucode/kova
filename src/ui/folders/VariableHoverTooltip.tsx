import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'

export type VariableTooltipEnvironmentRow = {
  id: string
  name: string
  isActive: boolean
  value: string
}

export function VariableHoverTooltip({
  variableName,
  rows,
  onToggleEnvironment,
  onOpenEnvironment,
  onChangeValue,
  onSaveValue,
}: {
  variableName: string
  rows: VariableTooltipEnvironmentRow[]
  onToggleEnvironment: (environmentId: string) => void
  onOpenEnvironment: (environmentId: string) => void
  onChangeValue: (environmentId: string, value: string) => void
  onSaveValue: (environmentId: string) => void
}) {
  const [draftRows, setDraftRows] = useState(rows)
  const activeCount = useMemo(() => draftRows.filter(row => row.isActive).length, [draftRows])

  useEffect(() => {
    setDraftRows(rows)
  }, [rows])

  return (
    <div className="w-[420px] overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm">
      <div className="border-b border-base-content/10 px-4 py-3">
        <div className="text-sm font-semibold text-base-content">Variable: {`{{${variableName}}}`}</div>
        <div className="mt-1 text-xs text-base-content/50">
          {activeCount > 0 ? `${activeCount} active environment${activeCount === 1 ? '' : 's'}` : 'No active environments'}
        </div>
      </div>

      <div className="max-h-[320px] overflow-auto">
        {draftRows.map(row => (
          <div key={row.id} className="grid grid-cols-[auto_minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 border-b border-base-content/10 px-3 py-2 last:border-b-0">
            <label className="flex items-center justify-center px-1">
              <input
                type="checkbox"
                className="checkbox checkbox-sm rounded-none border-none"
                checked={row.isActive}
                onChange={() => {
                  setDraftRows(current =>
                    current.map(currentRow =>
                      currentRow.id === row.id ? { ...currentRow, isActive: !currentRow.isActive } : currentRow
                    )
                  )
                  onToggleEnvironment(row.id)
                }}
                aria-label={row.isActive ? `Deactivate ${row.name}` : `Activate ${row.name}`}
              />
            </label>

            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => onOpenEnvironment(row.id)}
              title={`Open ${row.name}`}
            >
              <div className="truncate text-sm font-medium text-base-content">{row.name}</div>
              <div className="mt-0.5 text-[11px] text-base-content/45">{row.isActive ? 'Active' : 'Inactive'}</div>
            </button>

            <input
              className="input input-sm h-9 w-full rounded-xl border-base-content/10 bg-base-100/80"
              value={row.value}
              placeholder="Set value"
              onChange={event => {
                const nextValue = event.target.value
                setDraftRows(current =>
                  current.map(currentRow => (currentRow.id === row.id ? { ...currentRow, value: nextValue } : currentRow))
                )
              }}
              onBlur={() => {
                onChangeValue(row.id, row.value)
                void onSaveValue(row.id)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onChangeValue(row.id, row.value)
                  void onSaveValue(row.id)
                }
              }}
            />

            <button
              type="button"
              className="flex size-8 items-center justify-center rounded-lg border border-base-content/10 bg-base-100/70 text-base-content/60 transition hover:border-base-content/20 hover:bg-base-100 hover:text-base-content"
              onClick={() => onOpenEnvironment(row.id)}
              aria-label={`Open ${row.name}`}
              title={`Open ${row.name}`}
            >
              <ArrowUpRightIcon className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
