import { CopyIcon } from 'lucide-react'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { toast } from '@/lib/components/toast'
import { CodeEditor } from './CodeEditor'
import { scriptDocumentationByPhase, type ScriptDocumentationPhase } from './scriptDocumentation'

export function ScriptDocumentationDialog({
  phase,
  mode = 'full',
}: {
  phase: ScriptDocumentationPhase
  mode?: 'full' | 'examples'
}) {
  const documentation = scriptDocumentationByPhase[phase]
  const exampleEditorLanguage = phase === 'response-visualizer' ? 'jsx' : 'javascript'
  const title = mode === 'examples' ? `${documentation.title} Examples` : documentation.title

  return (
    <Dialog
      title={title}
      onClose={() => dialogActions.close()}
      className="max-w-[900px]"
      footer={
        <button type="button" className="btn btn-primary" onClick={() => dialogActions.close()}>
          Close
        </button>
      }
    >
      <article className="mx-auto max-w-[760px] text-[15px] leading-7 text-base-content/82 [&_code]:font-mono [&_code]:text-[0.95em] [&_h3]:mt-8 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-[0.01em] [&_h4]:mt-6 [&_h4]:text-sm [&_h4]:font-semibold [&_li]:marker:text-base-content/35 [&_p]:m-0">
        {mode === 'full' ? (
          <>
            <p className="text-base leading-8 text-base-content/72">{documentation.description}</p>

            <h3>Notes</h3>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-base-content/72">
              {documentation.notes.map(note => (
                <li key={note}>{note}</li>
              ))}
            </ul>

            {documentation.sections.map(section => (
              <section key={section.title} className="mt-8">
                <h3>{section.title}</h3>
                {section.description ? <p className="mt-2 text-base-content/68">{section.description}</p> : null}
                <ul className="mt-3 list-disc space-y-2 pl-5">
                  {section.entries.map(entry => (
                    <li key={entry.label}>
                      <code className="rounded bg-base-200/70 px-1.5 py-0.5 text-base-content">{entry.label}</code>
                      {' - '}
                      {entry.detail}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : (
          <p className="text-base leading-8 text-base-content/72">
            Curated examples for quickly bootstrapping a {documentation.title.toLowerCase().replace(' docs', '')}.
          </p>
        )}

        <h3>Examples</h3>
        {documentation.examples.map(example => (
          <section key={example.title} className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="m-0">{example.title}</h4>
              <div className="tooltip tooltip-left" data-tip="Copy example">
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-lg border border-base-content/10 bg-base-100/80 px-2.5 text-base-content/60 transition hover:border-base-content/20 hover:text-base-content"
                  onClick={() => void copyScriptExample(example.code)}
                  aria-label={`Copy ${example.title} example`}
                >
                  <CopyIcon className="size-4" />
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-200/40 shadow-sm">
              <CodeEditor
                value={example.code}
                language={exampleEditorLanguage}
                readOnly
                vimMode={false}
                size="small"
                className="border-0"
                hideFocusOutline
                onChange={() => undefined}
                compact
              />
            </div>
          </section>
        ))}
      </article>
    </Dialog>
  )
}

async function copyScriptExample(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    toast.show({ severity: 'success', message: 'Example copied to clipboard.' })
  } catch {
    toast.show({ severity: 'error', message: 'Could not copy the example.' })
  }
}
