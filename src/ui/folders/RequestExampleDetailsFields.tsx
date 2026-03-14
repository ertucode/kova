import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RequestExampleDetailsDraft } from './folderExplorerTypes'
import { FolderExplorerCoordinator } from './folderExplorerCoordinator'
import { HeadersEditor } from './HeadersEditor'
import { KeyValueEditor } from './KeyValueEditor'
import { DetailsTextArea } from './DetailsTextArea'
import { CodeEditor } from './CodeEditor'
import { DropdownSelect } from '@/lib/components/dropdown-select'
import { REQUEST_BODY_TYPES, REQUEST_RAW_TYPES } from './folderExplorerTypes'

export function RequestExampleDetailsFields({ draft }: { draft: RequestExampleDetailsDraft }) {
  const responseContentType = useMemo(() => getResponseContentType(draft.responseHeaders), [draft.responseHeaders])
  const parsedResponseJson = useMemo(() => parseJsonValue(draft.responseBody), [draft.responseBody])
  const canPrettyFormatResponse = responseContentType?.includes('json') || parsedResponseJson !== null
  const [formatResponseJson, setFormatResponseJson] = useState(canPrettyFormatResponse)

  useEffect(() => {
    if (!canPrettyFormatResponse) {
      setFormatResponseJson(false)
    }
  }, [canPrettyFormatResponse])

  const prettyResponseBody = useMemo(() => {
    if (!formatResponseJson || parsedResponseJson === null) {
      return draft.responseBody
    }

    return JSON.stringify(parsedResponseJson, null, 2)
  }, [draft.responseBody, formatResponseJson, parsedResponseJson])

  const toggleResponseFormatting = () => {
    if (!canPrettyFormatResponse) {
      return
    }

    const nextValue = !formatResponseJson
    setFormatResponseJson(nextValue)

    if (nextValue && parsedResponseJson !== null) {
      const formatted = JSON.stringify(parsedResponseJson, null, 2)
      if (formatted !== draft.responseBody) {
        FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseBody: formatted })
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <section className="grid border-b border-base-content/10 md:grid-cols-2">
        <Field label="Response Status">
          <input
            type="number"
            className="input h-10 w-full rounded-none border-base-content/10 bg-base-100/70"
            value={draft.responseStatus}
            onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseStatus: Number(event.target.value) || 0 })}
          />
        </Field>
        <Field label="Response Status Text">
          <input
            className="input h-10 w-full rounded-none border-base-content/10 bg-base-100/70"
            value={draft.responseStatusText}
            onChange={event => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseStatusText: event.target.value })}
          />
        </Field>
      </section>

      <section className="grid border-b border-base-content/10 md:grid-cols-[220px_220px]">
        <Field label="Request Body Type">
          <DropdownSelect
            value={draft.requestBodyType}
            className="w-full"
            triggerClassName="h-10 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-sm"
            menuClassName="w-[220px]"
            options={REQUEST_BODY_TYPES.map(value => ({ value, label: <span>{value}</span> }))}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestBodyType: value as typeof draft.requestBodyType })}
          />
        </Field>
        <Field label="Request Raw Type">
          <DropdownSelect
            value={draft.requestRawType}
            className="w-full"
            triggerClassName="h-10 rounded-none border border-base-content/10 bg-base-100/70 px-3 text-sm"
            menuClassName="w-[220px]"
            options={REQUEST_RAW_TYPES.map(value => ({ value, label: <span>{value}</span> }))}
            onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestRawType: value as typeof draft.requestRawType })}
          />
        </Field>
      </section>

      <HeadersEditor value={draft.requestHeaders} onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestHeaders: value })} />
      <DetailsTextArea label="Request Body" value={draft.requestBody} minHeightClassName="min-h-32" onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, requestBody: value })} onBlur={() => undefined} />
      <KeyValueEditor label="Response Headers" value={draft.responseHeaders} onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseHeaders: value })} keyPlaceholder="Content-Type" valuePlaceholder="application/json" valueEditorAsCode />
      <section className="w-full border-b border-base-content/10">
        <div className="flex items-center justify-between gap-3 p-2">
          <div className="text-sm font-semibold text-base-content">Response Body</div>
          <button
            type="button"
            className={[
              'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition',
              canPrettyFormatResponse
                ? formatResponseJson
                  ? 'border-info/30 bg-info/12 text-base-content'
                  : 'border-base-content/10 bg-base-100/70 text-base-content/65 hover:border-base-content/20 hover:text-base-content'
                : 'cursor-not-allowed border-base-content/10 bg-base-100/45 text-base-content/30',
            ].join(' ')}
            onClick={toggleResponseFormatting}
            disabled={!canPrettyFormatResponse}
          >
            Pretty JSON
          </button>
        </div>
        <CodeEditor
          value={prettyResponseBody}
          language={formatResponseJson && parsedResponseJson !== null ? 'json' : 'plain'}
          size="small"
          minHeightClassName="min-h-40"
          className="border-x-0 border-b-0"
          onChange={value => FolderExplorerCoordinator.updateSelectedDraft({ ...draft, responseBody: value })}
          onBlur={() => undefined}
        />
      </section>
    </div>
  )
}

function getResponseContentType(headers: string) {
  for (const row of headers.split('\n')) {
    const separatorIndex = row.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }

    const key = row.slice(0, separatorIndex).trim().toLowerCase()
    if (key !== 'content-type') {
      continue
    }

    return row.slice(separatorIndex + 1).trim().toLowerCase()
  }

  return null
}

function parseJsonValue(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  try {
    return JSON.parse(normalized) as unknown
  } catch {
    return null
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="border-r border-base-content/10 p-3 last:border-r-0">
      <div className="mb-2 text-[0.72rem] font-medium uppercase tracking-[0.08em] text-base-content/55">{label}</div>
      {children}
    </label>
  )
}
