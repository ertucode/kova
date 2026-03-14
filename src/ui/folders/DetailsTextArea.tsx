import { CodeEditor, type CodeEditorLanguage } from './CodeEditor'

export function DetailsTextArea({
  label,
  value,
  minHeightClassName,
  sectionClassName,
  editorLanguage,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string | null
  value: string
  minHeightClassName: string
  sectionClassName?: string
  editorLanguage?: CodeEditorLanguage
  placeholder?: string
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <section className={['w-full border-b border-base-content/10', sectionClassName].filter(Boolean).join(' ')}>
      {label ? <div className="p-2 text-sm text-base-content/55">{label}</div> : null}
      {editorLanguage ? (
        <CodeEditor
          value={value}
          language={editorLanguage}
          minHeightClassName={minHeightClassName}
          className="flex-1 border-x-0 border-b-0"
          placeholder={placeholder}
          onChange={onChange}
          onBlur={onBlur}
        />
      ) : (
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
      )}
    </section>
  )
}
