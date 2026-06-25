import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { parse, type SourceLocation } from 'graphql'
import { toast } from '@/lib/components/toast'
import { findTemplateScriptExpressions } from './codeEditorTemplateScript'
import { requestScriptDiagnostics } from './scriptAutocompleteClient'
import type { ScriptAutocompletePackage, ScriptAutocompleteSharedScript, ScriptDiagnosticsSuccess } from './scriptAutocompleteTypes'

const DIAGNOSTIC_DEBOUNCE_MS = 180
const setInlineDiagnosticsEffect = StateEffect.define<readonly GraphqlEditorDiagnostic[]>()

type GraphqlEditorDiagnostic = {
  from: number
  to: number
  message: string
  line: number | null
}

type GraphqlDiagnosticsState = {
  initialized: boolean
  timeoutId: number | null
  abortController: AbortController | null
}

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
  '.cm-inline-graphql-error': {
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

export function graphqlDiagnosticsExtension(options?: {
  getSharedScripts?: () => ScriptAutocompleteSharedScript[]
  getPackages?: () => ScriptAutocompletePackage[]
}): Extension {
  return [
    inlineDiagnosticsField,
    inlineDiagnosticsTheme,
    EditorView.updateListener.of(update => {
      const view = update.view
      const pluginState = getGraphqlDiagnosticsState(view)
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
        const source = view.state.doc.toString()
        const expressions = findTemplateScriptExpressions(source)

        void Promise.all(
          expressions.map(expression =>
            requestScriptDiagnostics({
              runtimeContext: { templatePhase: 'pre-request' },
              code: expression.code,
              sharedScripts: options?.getSharedScripts?.(),
              packages: options?.getPackages?.(),
              signal: abortController.signal,
            })
          )
        )
          .then(results => {
            if (abortController.signal.aborted || !view.dom.isConnected) {
              return
            }

            dispatchDiagnostics(view, buildGraphqlEditorDiagnostics(source, expressions, results))
          })
          .catch(() => {
            if (!view.dom.isConnected) {
              return
            }

            dispatchDiagnostics(view, buildGraphqlEditorDiagnostics(source, expressions, []))
          })
      }, DIAGNOSTIC_DEBOUNCE_MS)
    }),
  ]
}

function getGraphqlDiagnosticsState(view: EditorView) {
  const viewWithState = view as EditorView & { __kovaGraphqlDiagnosticsState?: GraphqlDiagnosticsState }
  viewWithState.__kovaGraphqlDiagnosticsState ??= {
    initialized: false,
    timeoutId: null,
    abortController: null,
  }
  return viewWithState.__kovaGraphqlDiagnosticsState
}

function buildGraphqlEditorDiagnostics(
  source: string,
  expressions: ReturnType<typeof findTemplateScriptExpressions>,
  results: Array<ScriptDiagnosticsSuccess | null>
) {
  const diagnostics: GraphqlEditorDiagnostic[] = []
  const graphqlDiagnostic = getGraphqlDiagnostic(source)

  if (graphqlDiagnostic) {
    diagnostics.push(graphqlDiagnostic)
  }

  for (const [index, result] of results.entries()) {
    if (!result) {
      continue
    }

    const expression = expressions[index]
    if (!expression) {
      continue
    }

    for (const diagnostic of result.diagnostics) {
      diagnostics.push({
        from: expression.contentFrom + diagnostic.from,
        to: expression.contentFrom + diagnostic.to,
        message: diagnostic.message,
        line: getDocumentLineNumber(source, expression.contentFrom + diagnostic.from),
      })
    }
  }

  return diagnostics.sort((left, right) => left.from - right.from || left.to - right.to)
}

function getGraphqlDiagnostic(source: string): GraphqlEditorDiagnostic | null {
  try {
    parse(source)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const location = getGraphqlErrorLocation(error)
    const from = Math.max(0, Math.min(source.length, location?.position ?? 0))
    const to = Math.min(source.length, Math.max(from + 1, from + getDiagnosticSpanLength(source, from)))

    return {
      from,
      to,
      message,
      line: location?.line ?? null,
    }
  }
}

function getGraphqlErrorLocation(error: unknown) {
  const sourceLocation =
    typeof error === 'object' && error !== null && 'source' in error && error.source && typeof error.source === 'object'
      ? (error.source as { locationOffset?: SourceLocation | undefined }).locationOffset
      : undefined
  const location =
    typeof error === 'object' && error !== null && 'locations' in error && Array.isArray(error.locations)
      ? error.locations[0]
      : undefined
  const position = typeof error === 'object' && error !== null && 'positions' in error && Array.isArray(error.positions)
    ? error.positions[0]
    : undefined

  if (!location || typeof position !== 'number') {
    return null
  }

  const lineOffset = (sourceLocation?.line ?? 1) - 1
  return {
    line: location.line + lineOffset,
    position,
  }
}

function getDocumentLineNumber(source: string, offset: number) {
  let line = 1
  for (let index = 0; index < Math.min(offset, source.length); index += 1) {
    if (source[index] === '\n') {
      line += 1
    }
  }

  return line
}

function getDiagnosticSpanLength(source: string, from: number) {
  const remaining = source.slice(from)
  const nextNewlineIndex = remaining.indexOf('\n')

  if (nextNewlineIndex === -1) {
    return remaining.length || 1
  }

  return nextNewlineIndex || 1
}

function dispatchDiagnostics(view: EditorView, diagnostics: GraphqlEditorDiagnostic[]) {
  const lintTransaction = setDiagnostics(
    view.state,
    diagnostics.map(
      diagnostic =>
        ({
          from: diagnostic.from,
          to: diagnostic.to,
          severity: 'error',
          message: diagnostic.message,
        }) satisfies Diagnostic
    )
  )
  const lintEffects = lintTransaction.effects
    ? Array.isArray(lintTransaction.effects)
      ? lintTransaction.effects
      : [lintTransaction.effects]
    : []

  view.dispatch({
    ...lintTransaction,
    effects: [...lintEffects, setInlineDiagnosticsEffect.of(diagnostics)],
  })
}

function buildInlineDiagnosticsDecorations(source: string, diagnostics: readonly GraphqlEditorDiagnostic[]) {
  const lines = source.split('\n')
  const firstDiagnosticByLine = new Map<number, GraphqlEditorDiagnostic>()

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
      builder.add(lineEnd, lineEnd, Decoration.widget({ widget: new InlineGraphqlDiagnosticWidget(diagnostic.message), side: 1 }))
    }

    position = lineEnd + 1
  }

  return builder.finish()
}

class InlineGraphqlDiagnosticWidget extends WidgetType {
  constructor(private readonly message: string) {
    super()
  }

  override eq(other: InlineGraphqlDiagnosticWidget) {
    return other.message === this.message
  }

  override toDOM() {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'cm-inline-graphql-error'
    element.textContent = this.message
    element.title = 'Copy error message'
    element.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.message).then(
        () => {
          toast.show({ severity: 'success', message: 'Copied GraphQL error message.' })
        },
        () => {
          toast.show({ severity: 'error', message: 'Could not copy GraphQL error message.' })
        }
      )
    })
    return element
  }
}
