import type { ReactNode } from 'react'

export function DetailsSectionHeader({
  title,
  actions,
}: {
  title: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex h-12 min-h-12 max-h-12 items-stretch border-b border-base-content/10">
      <div className="flex min-w-0 flex-1 items-center px-3 text-sm font-semibold text-base-content">{title}</div>
      {actions ? <div className="flex shrink-0 items-stretch">{actions}</div> : null}
    </div>
  )
}
