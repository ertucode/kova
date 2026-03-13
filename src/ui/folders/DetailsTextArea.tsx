export function DetailsTextArea({
  label,
  value,
  minHeightClassName,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string | null
  value: string
  minHeightClassName: string
  placeholder?: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <section className="w-full border-b border-base-content/10">
      {label ? <div className="p-2 text-sm text-base-content/55">{label}</div> : null}
      <textarea
        className={[
          'textarea w-full rounded-none border-base-content/10 bg-base-100/70 font-mono text-sm leading-6',
          minHeightClassName,
        ].join(' ')}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </section>
  )
}
