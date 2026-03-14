import type { Extension } from '@codemirror/state'
import { KeyValueEditor } from './KeyValueEditor'

export function HeadersEditor({
  value,
  onChange,
  valueEditorExtensions,
}: {
  value: string
  onChange: (value: string) => void
  valueEditorExtensions?: Extension[]
}) {
  return (
    <KeyValueEditor
      label="Headers"
      value={value}
      onChange={onChange}
      keyPlaceholder="Authorization"
      valuePlaceholder="Bearer ..."
      valueEditorAsCode
      valueEditorExtensions={valueEditorExtensions}
    />
  )
}
