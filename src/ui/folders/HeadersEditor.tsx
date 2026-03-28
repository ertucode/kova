import type { Extension } from '@codemirror/state'
import { KeyValueEditor } from './KeyValueEditor'

export function HeadersEditor({
  value,
  onChange,
  valueEditorExtensions,
  valueEditorRefreshKey,
}: {
  value: string
  onChange: (value: string) => void
  valueEditorExtensions?: Extension[]
  valueEditorRefreshKey?: string
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
      valueEditorRefreshKey={valueEditorRefreshKey}
    />
  )
}
