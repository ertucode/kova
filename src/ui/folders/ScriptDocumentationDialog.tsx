import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from '@/global/dialogStore'
import { scriptDocumentationByPhase, type ScriptDocumentationPhase } from './scriptDocumentation'

export function ScriptDocumentationDialog({ phase }: { phase: ScriptDocumentationPhase }) {
  const documentation = scriptDocumentationByPhase[phase]

  return (
    <Dialog
      title={documentation.title}
      onClose={() => dialogActions.close()}
      className="max-w-[900px]"
      footer={
        <button type="button" className="btn btn-primary" onClick={() => dialogActions.close()}>
          Close
        </button>
      }
    >
      <article className="mx-auto max-w-[760px] text-[15px] leading-7 text-base-content/82 [&_code]:font-mono [&_code]:text-[0.95em] [&_h3]:mt-8 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-[0.01em] [&_h4]:mt-6 [&_h4]:text-sm [&_h4]:font-semibold [&_li]:marker:text-base-content/35 [&_p]:m-0">
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

        <h3>Examples</h3>
        {documentation.examples.map(example => (
          <section key={example.title} className="mt-6">
            <h4 className="mb-3">{example.title}</h4>
            <pre className="overflow-x-auto rounded-2xl border border-base-content/10 bg-base-200/80 px-4 py-4 text-[13px] leading-6 text-base-content shadow-sm">
              <code>{example.code}</code>
            </pre>
          </section>
        ))}
      </article>
    </Dialog>
  )
}
