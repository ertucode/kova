import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import type { DetailsDraft } from './folderExplorerTypes'
import type { EditorEntry } from './folderExplorerEditorStore'

export function UnsavedChangesDebugDialog({
  entry,
  itemName,
}: {
  entry: EditorEntry | null
  itemName: string
}) {
  const fieldDiffs = buildFieldDiffs(entry?.base ?? null, entry?.current ?? null)
  const hasSerializedDiff = (entry?.serializedBase ?? '') !== (entry?.serializedCurrent ?? '')

  return (
    <Dialog
      title="Unsaved Changes Diff"
      onClose={() => dialogActions.close()}
      className="max-w-[1100px]"
      footer={
        <button type="button" className="btn btn-primary" onClick={() => dialogActions.close()}>
          Close
        </button>
      }
    >
      <div className="space-y-5 text-sm text-base-content/78">
        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 px-4 py-3">
          <div className="font-medium text-base-content">{itemName || 'Untitled item'}</div>
          <div className="mt-1 text-xs text-base-content/55">
            Dirty flag is based on exact serialized draft equality: <code>serializedCurrent !== serializedBase</code>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <StatusBadge label={`Dirty: ${entry?.isDirty ? 'yes' : 'no'}`} tone={entry?.isDirty ? 'warning' : 'neutral'} />
            <StatusBadge label={`Changed fields: ${fieldDiffs.length}`} tone={fieldDiffs.length > 0 ? 'warning' : 'neutral'} />
            <StatusBadge label={`Serialized diff: ${hasSerializedDiff ? 'yes' : 'no'}`} tone={hasSerializedDiff ? 'warning' : 'neutral'} />
          </div>
        </div>

        {fieldDiffs.length > 0 ? (
          <section className="space-y-3">
            <h4 className="text-sm font-semibold text-base-content">Field Diffs</h4>
            {fieldDiffs.map(diff => (
              <div key={diff.field} className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
                <div className="border-b border-base-content/10 px-4 py-2 font-mono text-xs text-base-content/60">
                  {diff.field}
                </div>
                <div className="grid gap-px bg-base-content/10 md:grid-cols-2">
                  <DiffPane label="Base" value={diff.baseFormatted} />
                  <DiffPane label="Current" value={diff.currentFormatted} />
                </div>
              </div>
            ))}
          </section>
        ) : (
          <div className="rounded-2xl border border-base-content/10 bg-base-100/70 px-4 py-3 text-sm text-base-content/62">
            No top-level field diff detected.
          </div>
        )}

        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-base-content">Serialized Payload</h4>
          <div className="grid gap-3 md:grid-cols-2">
            <SerializedPane label="serializedBase" value={formatSerializedPayload(entry?.serializedBase ?? '')} />
            <SerializedPane label="serializedCurrent" value={formatSerializedPayload(entry?.serializedCurrent ?? '')} />
          </div>
        </section>
      </div>
    </Dialog>
  )
}

function DiffPane({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-base-100 px-4 py-3">
      <div className="mb-2 text-xs font-medium tracking-[0.04em] text-base-content/45 uppercase">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-base-200/45 p-3 font-mono text-[12px] leading-5 text-base-content/82">
        {value}
      </pre>
    </div>
  )
}

function SerializedPane({ label, value }: { label: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100/70">
      <div className="border-b border-base-content/10 px-4 py-2 font-mono text-xs text-base-content/60">{label}</div>
      <pre className="max-h-[320px] overflow-auto px-4 py-3 font-mono text-[12px] leading-5 text-base-content/82">{value || '(empty)'}</pre>
    </div>
  )
}

function StatusBadge({ label, tone }: { label: string; tone: 'warning' | 'neutral' }) {
  return (
    <span
      className={[
        'rounded-full border px-2.5 py-1 font-medium',
        tone === 'warning'
          ? 'border-warning/25 bg-warning/10 text-warning'
          : 'border-base-content/10 bg-base-100/70 text-base-content/58',
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function buildFieldDiffs(base: DetailsDraft | null, current: DetailsDraft | null) {
  const baseRecord = toComparableRecord(base)
  const currentRecord = toComparableRecord(current)
  const fieldNames = new Set([...Object.keys(baseRecord), ...Object.keys(currentRecord)])

  return [...fieldNames]
    .sort((left, right) => left.localeCompare(right))
    .flatMap(field => {
      const baseValue = baseRecord[field]
      const currentValue = currentRecord[field]
      if (JSON.stringify(baseValue) === JSON.stringify(currentValue)) {
        return []
      }

      return [
        {
          field,
          baseFormatted: formatDebugValue(baseValue),
          currentFormatted: formatDebugValue(currentValue),
        },
      ]
    })
}

function toComparableRecord(value: DetailsDraft | null): Record<string, unknown> {
  if (!value) {
    return {}
  }

  return value as unknown as Record<string, unknown>
}

function formatDebugValue(value: unknown) {
  if (typeof value === 'string') {
    return value.length > 0 ? value : '(empty string)'
  }

  if (value === undefined) {
    return '(undefined)'
  }

  if (value === null) {
    return '(null)'
  }

  return JSON.stringify(value, null, 2)
}

function formatSerializedPayload(value: string) {
  if (!value) {
    return '(empty)'
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}
