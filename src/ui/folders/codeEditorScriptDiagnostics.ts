import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { toast } from '@/lib/components/toast'
import { requestScriptDiagnostics } from './scriptAutocompleteClient'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import type { ScriptEditorDiagnostic } from './scriptAutocompleteTypes'

const DIAGNOSTIC_DEBOUNCE_MS = 180
const setInlineDiagnosticsEffect = StateEffect.define<readonly ScriptEditorDiagnostic[]>()

const inlineDiagnosticsField = StateField.define({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    decorations = decorations.map(transaction.changes)

    for (const effect of transaction.effects) {
      if (effect.is(setInlineDiagnosticsEffect)) {
        return buildInlineDiagnosticsDecorations(transaction.state.doc.toString(), effect.value)
      }
    }

    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})

const inlineDiagnosticsTheme = EditorView.theme({
  '.cm-inline-script-error': {
    display: 'inline-flex',
    maxWidth: 'min(38rem, 55vw)',
    marginLeft: '0.75rem',
    padding: '0 0.45rem',
    appearance: 'none',
    borderRadius: '0.35rem',
    border: '1px solid color-mix(in oklab, var(--color-error) 22%, transparent)',
    backgroundColor: 'color-mix(in oklab, var(--color-error) 10%, transparent)',
    color: 'color-mix(in oklab, var(--color-error) 85%, var(--color-base-content) 15%)',
    fontSize: '0.72rem',
    lineHeight: '1.2rem',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    userSelect: 'text',
    cursor: 'copy',
  },
  '.cm-lintRange-error': {
    backgroundColor: 'transparent',
    backgroundImage: 'none !important',
    textDecorationLine: 'underline',
    textDecorationStyle: 'solid',
    textDecorationColor: 'color-mix(in oklab, var(--color-error) 82%, transparent)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '0.18rem',
  },
})

export function scriptDiagnosticsExtension(phase: ScriptAutocompletePhase): Extension {
  return [
    inlineDiagnosticsField,
    inlineDiagnosticsTheme,
    EditorView.updateListener.of(update => {
      const view = update.view
      const pluginState = getScriptDiagnosticsState(view)

      if (!update.docChanged && pluginState.initialized) {
        return
      }

      pluginState.initialized = true

      if (pluginState.timeoutId !== null) {
        window.clearTimeout(pluginState.timeoutId)
      }

      pluginState.abortController?.abort()
      pluginState.timeoutId = window.setTimeout(() => {
        pluginState.timeoutId = null
        pluginState.abortController?.abort()
        const abortController = new AbortController()
        pluginState.abortController = abortController
        const code = view.state.doc.toString()

        void requestScriptDiagnostics({ phase, code, signal: abortController.signal })
          .then(result => {
            if (abortController.signal.aborted || !result || !view.dom.isConnected) {
              return
            }

            const diagnostics = result.diagnostics.map(diagnostic => ({
              from: diagnostic.from,
              to: diagnostic.to,
              severity: 'error',
              message: diagnostic.message,
            }) satisfies Diagnostic)

            const lintTransaction = setDiagnostics(view.state, diagnostics)
            const lintEffects = lintTransaction.effects
              ? Array.isArray(lintTransaction.effects)
                ? lintTransaction.effects
                : [lintTransaction.effects]
              : []
            view.dispatch({
              ...lintTransaction,
              effects: [...lintEffects, setInlineDiagnosticsEffect.of(result.diagnostics)],
            })
          })
          .catch(() => {
            if (!view.dom.isConnected) {
              return
            }

            const lintTransaction = setDiagnostics(view.state, [])
            const lintEffects = lintTransaction.effects
              ? Array.isArray(lintTransaction.effects)
                ? lintTransaction.effects
                : [lintTransaction.effects]
              : []
            view.dispatch({
              ...lintTransaction,
              effects: [...lintEffects, setInlineDiagnosticsEffect.of([])],
            })
          })
      }, DIAGNOSTIC_DEBOUNCE_MS)
    }),
  ]
}

type ScriptDiagnosticsState = {
  initialized: boolean
  timeoutId: number | null
  abortController: AbortController | null
}

function getScriptDiagnosticsState(view: EditorView) {
  const viewWithState = view as EditorView & { __kovaScriptDiagnosticsState?: ScriptDiagnosticsState }
  viewWithState.__kovaScriptDiagnosticsState ??= {
    initialized: false,
    timeoutId: null,
    abortController: null,
  }
  return viewWithState.__kovaScriptDiagnosticsState
}

function buildInlineDiagnosticsDecorations(source: string, diagnostics: readonly ScriptEditorDiagnostic[]) {
  const lines = source.split('\n')
  const firstDiagnosticByLine = new Map<number, ScriptEditorDiagnostic>()

  for (const diagnostic of diagnostics) {
    if (diagnostic.line === null || firstDiagnosticByLine.has(diagnostic.line)) {
      continue
    }

    firstDiagnosticByLine.set(diagnostic.line, diagnostic)
  }

  const builder = new RangeSetBuilder<Decoration>()
  let position = 0
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const lineText = lines[index] ?? ''
    const diagnostic = firstDiagnosticByLine.get(lineNumber)
    const lineEnd = position + lineText.length

    if (diagnostic) {
      builder.add(
        lineEnd,
        lineEnd,
        Decoration.widget({ widget: new InlineScriptDiagnosticWidget(diagnostic.message), side: 1 })
      )
    }

    position = lineEnd + 1
  }

  return builder.finish()
}

class InlineScriptDiagnosticWidget extends WidgetType {
  constructor(private readonly message: string) {
    super()
  }

  override eq(other: InlineScriptDiagnosticWidget) {
    return other.message === this.message
  }

  override toDOM() {
    const element = document.createElement('button')
    element.className = 'cm-inline-script-error'
    element.textContent = this.message
    element.title = this.message
    element.setAttribute('aria-label', this.message)
    element.type = 'button'
    element.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.message).then(
        () => toast.show({ severity: 'success', message: 'Diagnostic copied to clipboard.' }),
        () => toast.show({ severity: 'error', message: 'Failed to copy diagnostic.' })
      )
    })
    return element
  }

  override ignoreEvent() {
    return false
  }
}
