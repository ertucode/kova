import type { ReactNode } from 'react'
import type { Extension } from '@codemirror/state'
import type { HttpAuth } from '@common/Auth'
import { AUTH_LOCATIONS, AUTH_TYPES, AUTH_TYPES_WITHOUT_INHERIT } from '@common/Auth'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { CodeEditor } from './CodeEditor'
import { DetailsSectionHeader } from './DetailsSectionHeader'

export function AuthorizationEditor({
  value,
  onChange,
  allowInherit,
  valueEditorExtensions,
}: {
  value: HttpAuth
  onChange: (value: HttpAuth) => void
  allowInherit?: boolean
  valueEditorExtensions?: Extension[]
}) {
  const typeOptions = (allowInherit ? AUTH_TYPES : AUTH_TYPES_WITHOUT_INHERIT).map(type => ({
    value: type,
    label: <span className="capitalize">{type === 'noauth' ? 'No Auth' : type === 'apikey' ? 'API Key' : type}</span>,
  }))

  return (
    <section className="w-full border-b border-base-content/10">
      <DetailsSectionHeader title="Authorization" />

      <div className="border border-base-content/10 bg-base-100/35 p-3">
        <DropdownSelect
          value={value.type}
          className="w-full max-w-[220px]"
          triggerClassName="h-9 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-xs font-medium capitalize"
          menuClassName="w-[220px]"
          options={typeOptions}
          onChange={nextType => onChange(createAuthByType(nextType as HttpAuth['type'], value))}
        />

        <div className="mt-3">
          {value.type === 'inherit' ? <Message text="Use the nearest folder authorization." /> : null}
          {value.type === 'noauth' ? <Message text="Send this request without auth helper headers or query params." /> : null}
          {value.type === 'bearer' ? (
            <Field label="Token">
              <CodeEditor
                value={value.token}
                language="plain"
                singleLine
                compact
                size="small"
                hideFocusOutline
                className="h-9 border border-base-content/10 bg-base-100/70"
                placeholder="{{IdToken}}"
                extensions={valueEditorExtensions}
                onChange={nextValue => onChange({ ...value, token: nextValue })}
              />
            </Field>
          ) : null}
          {value.type === 'basic' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Username">
                <CodeEditor
                  value={value.username}
                  language="plain"
                  singleLine
                  compact
                  size="small"
                  hideFocusOutline
                  className="h-9 border border-base-content/10 bg-base-100/70"
                  placeholder="username"
                  extensions={valueEditorExtensions}
                  onChange={nextValue => onChange({ ...value, username: nextValue })}
                />
              </Field>
              <Field label="Password">
                <CodeEditor
                  value={value.password}
                  language="plain"
                  singleLine
                  compact
                  size="small"
                  hideFocusOutline
                  className="h-9 border border-base-content/10 bg-base-100/70"
                  placeholder="password"
                  extensions={valueEditorExtensions}
                  onChange={nextValue => onChange({ ...value, password: nextValue })}
                />
              </Field>
            </div>
          ) : null}
          {value.type === 'apikey' ? (
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
              <Field label="Key">
                <CodeEditor
                  value={value.key}
                  language="plain"
                  singleLine
                  compact
                  size="small"
                  hideFocusOutline
                  className="h-9 border border-base-content/10 bg-base-100/70"
                  placeholder="Authorization"
                  extensions={valueEditorExtensions}
                  onChange={nextValue => onChange({ ...value, key: nextValue })}
                />
              </Field>
              <Field label="Value">
                <CodeEditor
                  value={value.value}
                  language="plain"
                  singleLine
                  compact
                  size="small"
                  hideFocusOutline
                  className="h-9 border border-base-content/10 bg-base-100/70"
                  placeholder="{{apiKey}}"
                  extensions={valueEditorExtensions}
                  onChange={nextValue => onChange({ ...value, value: nextValue })}
                />
              </Field>
              <Field label="Add To">
                <DropdownSelect
                  value={value.addTo}
                  className="w-full"
                  triggerClassName="h-9 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-xs font-medium capitalize"
                  menuClassName="w-[180px]"
                  options={AUTH_LOCATIONS.map(location => ({ value: location, label: <span className="capitalize">{location}</span> }))}
                  onChange={nextLocation => onChange({ ...value, addTo: nextLocation as (typeof AUTH_LOCATIONS)[number] })}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-base-content/55">{label}</span>
      {children}
    </label>
  )
}

function Message({ text }: { text: string }) {
  return <div className="text-[0.78rem] text-base-content/55">{text}</div>
}

function createAuthByType(type: HttpAuth['type'], current: HttpAuth): HttpAuth {
  switch (type) {
    case 'inherit':
    case 'noauth':
      return { type }
    case 'bearer':
      return current.type === 'bearer' ? current : { type: 'bearer', token: '' }
    case 'apikey':
      return current.type === 'apikey' ? current : { type: 'apikey', key: '', value: '', addTo: 'header' }
    case 'basic':
      return current.type === 'basic' ? current : { type: 'basic', username: '', password: '' }
  }
}
