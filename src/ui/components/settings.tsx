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

export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        '[&>section]:border-x-0 [&>section]:border-t-0 [&>section]:border-b-base-content/10 [&>section]:bg-transparent [&>section]:px-0 [&>section]:py-4 [&>section:last-child]:border-b-0',
        className
      )}
    >
      {children}
    </div>
  )
}

export function SettingsControlLabel({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-1 text-xs font-medium text-base-content/60">{label}</div>
      {children}
    </label>
  )
}

export function SettingsFieldRow({
  title,
  description,
  control,
  detail,
  className,
}: {
  title: ReactNode
  description: ReactNode
  control?: ReactNode
  detail?: ReactNode
  className?: string
}) {
  return (
    <section className={clsx('flex flex-col gap-3 border border-base-content/10 bg-base-100/70 p-4', className)}>
      <div>
        <div className="text-sm font-medium text-base-content">{title}</div>
        <div className="mt-1 text-xs text-base-content/60">{description}</div>
      </div>
      {control && <div className="w-full lg:w-[320px] lg:shrink-0">{control}</div>}
      {detail ? <div>{detail}</div> : null}
    </section>
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
  disabled,
  detail,
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
  disabled?: boolean
  detail?: ReactNode
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
      detail={detail}
      control={
        <DropdownSelect
          value={value}
          options={optionsOut}
          onChange={onChange}
          className={clsx('w-full', dropdownClassName)}
          triggerClassName={clsx('h-11 text-sm px-2 bg-base-content/10', triggerClassName)}
          menuClassName={clsx('w-[320px]', menuClassName)}
          disabled={disabled}
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
  detail,
  disabled,
}: {
  title: ReactNode
  description: ReactNode
  value: boolean
  onChange: (value: boolean) => void
  className?: string
  detail?: ReactNode
  disabled?: boolean
}) {
  return (
    <SettingsFieldRow
      title={title}
      description={
        <label className="inline-flex items-center gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm rounded-md"
            checked={value}
            onChange={event => onChange(event.target.checked)}
            disabled={disabled}
          />
          <span className="text-xs text-base-content/60">{description}</span>
        </label>
      }
      className={className}
      detail={detail}
    />
  )
}

export function SettingsTextareaFieldRow({
  title,
  description,
  value,
  onChange,
  className,
  textareaClassName,
  ...rest
}: {
  title: ReactNode
  description: ReactNode
  value: string
  onChange: (value: string) => void
  className?: string
  textareaClassName?: string
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>) {
  return (
    <SettingsFieldRow
      title={title}
      description={description}
      className={className}
      detail={
        <textarea
          className={clsx(
            'textarea min-h-36 w-full border-base-content/10 bg-base-content/10 font-mono text-sm leading-6',
            textareaClassName
          )}
          value={value}
          onChange={event => onChange(event.target.value)}
          {...rest}
        />
      }
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
          className={clsx('input h-11 w-full rounded-none border-base-content/10 bg-base-content/10', inputClassName)}
          value={value}
          onChange={event => onChange(event.target.value)}
          {...rest}
        />
      }
    />
  )
}
