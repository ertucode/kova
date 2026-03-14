import { useEffect, useState } from 'react'

export function PathParamHoverTooltip({
  paramName,
  value,
  description,
  onChangeValue,
}: {
  paramName: string
  value: string
  description: string
  onChangeValue: (value: string) => void
}) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  const commit = () => {
    window.setTimeout(() => {
      onChangeValue(draftValue)
    }, 0)
  }

  return (
    <div className="w-[320px] overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm">
      <div className="border-b border-base-content/10 px-4 py-3">
        <div className="text-sm font-semibold text-base-content">Path Param: {`:${paramName}`}</div>
        <div className="mt-1 text-xs text-base-content/55">{description.trim() || 'Used in the request URL path.'}</div>
      </div>

      <div className="px-4 py-3">
        <input
          autoFocus
          className="input input-sm h-10 w-full rounded-xl border-base-content/10 bg-base-100/85"
          value={draftValue}
          placeholder="Set value"
          onChange={event => setDraftValue(event.target.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
      </div>
    </div>
  )
}
