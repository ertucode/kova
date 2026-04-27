import type { Extension } from '@codemirror/state'
import { KeyValueEditor } from './KeyValueEditor'

export function HeadersEditor({
  value,
  onChange,
  showHeader = true,
  valueEditorExtensions,
  valueEditorRefreshKey,
}: {
  value: string
  onChange: (value: string) => void
  showHeader?: boolean
  valueEditorExtensions?: Extension[]
  valueEditorRefreshKey?: string
}) {
  return (
    <KeyValueEditor
      label={showHeader ? 'Headers' : null}
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
