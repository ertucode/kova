import { useMemo, type ReactNode } from 'react'
import { DropdownSelect, type DropdownSelectOption } from '@/lib/components/dropdown-select'
import { clsx } from '@/lib/functions/clsx'

export function SettingsTab({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section className={clsx('min-h-0 flex-1 overflow-auto', className)}>
      <div className={clsx('space-y-3', contentClassName)}>{children}</div>
    </section>
  )
}

export function SettingsFieldRow({
  title,
  description,
  control,
  className,
}: {
  title: ReactNode
  description: ReactNode
  control?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col gap-1 border border-base-content/10 bg-base-100/70 p-3', className)}>
      <div className="flex flex-col gap-0">
        <div className="text-sm font-medium text-base-content">{title}</div>
        <div className="mt-1 text-xs text-base-content/60">{description}</div>
      </div>
      {control && <div className="w-full lg:w-[320px] lg:shrink-0">{control}</div>}
    </div>
  )
}

export function SettingsDropdownFieldRow<T extends string>({
  title,
  description,
  value,
  options,
  onChange,
  className,
  dropdownClassName,
  triggerClassName,
  menuClassName,
}: {
  title: ReactNode
  description: ReactNode
  value: T
  options: DropdownSelectOption<T>[] | T[]
  onChange: (value: T) => void
  className?: string
  dropdownClassName?: string
  triggerClassName?: string
  menuClassName?: string
}) {
  const optionsOut: DropdownSelectOption<T>[] = useMemo(() => {
    if (options.length === 0) return [] as DropdownSelectOption<T>[]

    if (typeof options[0] === 'string')
      return options.map(option => ({
        value: option,
        label: <span>{option as string}</span>,
      })) as DropdownSelectOption<T>[]

    return options as DropdownSelectOption<T>[]
  }, [options])

  return (
    <SettingsFieldRow
      title={title}
      description={description}
      className={className}
      control={
        <DropdownSelect
          value={value}
          options={optionsOut}
          onChange={onChange}
          className={clsx('w-full', dropdownClassName)}
          triggerClassName={clsx('h-11 text-sm px-2 bg-base-content/10', triggerClassName)}
          menuClassName={clsx('w-[320px]', menuClassName)}
        />
      }
    />
  )
}

export function SettingsCheckboxFieldRow({
  title,
  description,
  value,
  onChange,
  className,
}: {
  title: ReactNode
  description: ReactNode
  value: boolean
  onChange: (value: boolean) => void
  className?: string
}) {
  return (
    <SettingsFieldRow
      title={title}
      description={
        <label className="mt-1 inline-flex items-center gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm rounded-md"
            checked={value}
            onChange={event => onChange(event.target.checked)}
          />
          <span className="text-xs text-base-content/60">{description}</span>
        </label>
      }
      className={className}
    />
  )
}

export function SettingsInputFieldRow({
  title,
  description,
  value,
  onChange,
  className,
  inputClassName,
  ...rest
}: {
  title: ReactNode
  description: ReactNode
  value: string
  onChange: (value: string) => void
  className?: string
  inputClassName?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <SettingsFieldRow
      title={title}
      description={description}
      className={className}
      control={
        <input
          className={clsx(
            'input input-sm w-full border-base-content/10 bg-base-content/10 rounded-none',
            inputClassName
          )}
          value={value}
          onChange={event => onChange(event.target.value)}
          {...rest}
        />
      }
    />
  )
}
