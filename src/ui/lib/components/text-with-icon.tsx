type TextWithIconProps = {
  icon?: $Maybe<React.ComponentType<{ className?: string }>>
  children: React.ReactNode
  iconClassName?: string
  title?: string
}

export function TextWithIcon({ icon: Icon, children, iconClassName = 'size-4', title }: TextWithIconProps) {
  return (
    <div className="flex items-center gap-2" title={title}>
      {Icon && <Icon className={iconClassName} />}
      {children}
    </div>
  )
}
