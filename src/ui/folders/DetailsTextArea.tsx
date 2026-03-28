import type { ReactNode, Ref } from 'react'
import type { Extension } from '@codemirror/state'
import { CodeEditor, type CodeEditorHandle, type CodeEditorLanguage } from './CodeEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'

export function DetailsTextArea({
  label,
  value,
  minHeightClassName,
  sectionClassName,
  editorLanguage,
  editorSize,
  showLineNumbers,
  placeholder,
  extensions,
  editorRef,
  headerActions,
  onChange,
  onBlur,
}: {
  label: string | null
  value: string
  minHeightClassName: string
  sectionClassName?: string
  editorLanguage?: CodeEditorLanguage
  editorSize?: 'normal' | 'small'
  showLineNumbers?: boolean
  placeholder?: string
  extensions?: Extension[]
  editorRef?: Ref<CodeEditorHandle>
  headerActions?: ReactNode
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <section className={['w-full border-b border-base-content/10', sectionClassName].filter(Boolean).join(' ')}>
      {label ? <DetailsSectionHeader title={label} actions={headerActions} /> : null}
      {editorLanguage ? (
        <CodeEditor
          ref={editorRef}
          value={value}
          language={editorLanguage}
          size={editorSize}
          showLineNumbers={showLineNumbers}
          minHeightClassName={minHeightClassName}
          className="flex-1 border-x-0 border-b-0"
          placeholder={placeholder}
          extensions={extensions}
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
