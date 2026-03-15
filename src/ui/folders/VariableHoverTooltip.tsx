import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'
export type VariableTooltipEnvironmentRow = {
  id: string
  name: string
  isActive: boolean
  value: string
  isEffective: boolean
  priority: number
  createdAt: number
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

  const commitValue = (environmentId: string) => {
    const nextValue = draftRows.find(row => row.id === environmentId)?.value ?? ''

    window.setTimeout(() => {
      onChangeValue(environmentId, nextValue)
      void onSaveValue(environmentId)
    }, 0)
  }

  return (
    <div className="w-[560px] overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm">
      <div className="border-b border-base-content/10 px-4 py-3">
        <div className="text-sm font-semibold text-base-content">Variable: {`{{${variableName}}}`}</div>
        <div className="mt-1 text-xs text-base-content/50">
          {activeCount > 0 ? `${activeCount} active environment${activeCount === 1 ? '' : 's'}` : 'No active environments'}
        </div>
      </div>

      <div className="max-h-[320px] overflow-auto">
        {draftRows.map(row => {
          const isEffective = getEffectiveEnvironmentId(draftRows) === row.id

          return (
          <div key={row.id} className="grid grid-cols-[auto_minmax(0,120px)_minmax(0,2fr)_auto] items-center gap-3 border-b border-base-content/10 px-3 py-2 last:border-b-0">
            <label className="flex items-center justify-center px-1">
              <input
                type="checkbox"
                className="checkbox checkbox-sm rounded-none border border-base-content/30 bg-base-100"
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
              onClick={() => {
                setDraftRows(current =>
                  current.map(currentRow =>
                    currentRow.id === row.id ? { ...currentRow, isActive: !currentRow.isActive } : currentRow
                  )
                )
                onToggleEnvironment(row.id)
              }}
              title={row.isActive ? `Deactivate ${row.name}` : `Activate ${row.name}`}
            >
              <div className="flex items-center gap-2">
                <div className="truncate text-sm font-medium text-base-content">{row.name}</div>
                {isEffective ? (
                  <span
                    className="size-2 shrink-0 rounded-full bg-info shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-info)_16%,transparent)]"
                    aria-label="Effective environment"
                    title="Effective environment"
                  />
                ) : null}
              </div>
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
                commitValue(row.id)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitValue(row.id)
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
          )
        })}
      </div>
    </div>
  )
}

function getEffectiveEnvironmentId(rows: VariableTooltipEnvironmentRow[]) {
  return rows
    .filter(row => row.isActive && row.value.trim() !== '')
    .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)[0]?.id ?? null
}
