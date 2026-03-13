import { KeyValueEditor } from './KeyValueEditor'

export function HeadersEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <KeyValueEditor
      label="Headers"
      value={value}
      onChange={onChange}
      keyPlaceholder="Authorization"
      valuePlaceholder="Bearer ..."
    />
  )
}
