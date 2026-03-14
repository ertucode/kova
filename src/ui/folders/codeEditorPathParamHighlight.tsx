import { createRoot } from 'react-dom/client'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { PathParamHoverTooltip } from './PathParamHoverTooltip'

type PathParamMatch = {
  index: number
  length: number
  name: string
}

export function pathParamHighlightExtension({
  getDefinedPathParamNames,
  getPathParamValue,
  getPathParamDescription,
  onChangeValue,
}: {
  getDefinedPathParamNames: () => Iterable<string>
  getPathParamValue: (name: string) => string
  getPathParamDescription: (name: string) => string
  onChangeValue: (name: string, value: string) => void
}): Extension {
  return [
    EditorView.baseTheme({
      '.cm-path-param': {
        borderRadius: '0.375rem',
        padding: '0.05rem 0.2rem',
        border: '1px solid transparent',
        transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
      },
      '.cm-path-param-defined': {
        color: 'color-mix(in oklab, var(--color-success) 74%, var(--color-base-content) 26%) !important',
        backgroundColor: 'color-mix(in oklab, var(--color-success) 20%, transparent) !important',
        borderColor: 'color-mix(in oklab, var(--color-success) 42%, transparent) !important',
        boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--color-success) 54%, transparent)',
      },
      '.cm-path-param-undefined': {
        color: 'color-mix(in oklab, var(--color-warning) 78%, var(--color-base-content) 22%) !important',
        backgroundColor: 'color-mix(in oklab, var(--color-warning) 18%, transparent) !important',
        borderColor: 'color-mix(in oklab, var(--color-warning) 40%, transparent) !important',
        boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--color-warning) 52%, transparent)',
      },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, getDefinedPathParamNames)
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
            this.decorations = buildDecorations(update.view, getDefinedPathParamNames)
          }
        }
      },
      {
        decorations: value => value.decorations,
      }
    ),
    hoverTooltip(
      (view, pos, side) => {
        const match = getPathParamAtPosition(view, pos, side)
        if (!match) {
          return null
        }

        return {
          pos: match.from,
          end: match.to,
          above: false,
          create() {
            const dom = document.createElement('div')
            const root = createRoot(dom)

            root.render(
              <PathParamHoverTooltip
                paramName={match.name}
                value={getPathParamValue(match.name)}
                description={getPathParamDescription(match.name)}
                onChangeValue={value => onChangeValue(match.name, value)}
              />
            )

            return {
              dom,
              destroy() {
                root.unmount()
              },
            }
          },
        }
      },
      { hoverTime: 120 }
    ),
  ]
}

function buildDecorations(view: EditorView, getDefinedPathParamNames: () => Iterable<string>) {
  const builder = new RangeSetBuilder<Decoration>()
  const definedPathParamNames = new Set(Array.from(getDefinedPathParamNames(), name => name.trim()).filter(Boolean))

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)

    for (const match of findPathParamMatches(text)) {
      const start = from + match.index
      builder.add(
        start,
        start + match.length,
        Decoration.mark({
          class: definedPathParamNames.has(match.name)
            ? 'cm-path-param cm-path-param-defined'
            : 'cm-path-param cm-path-param-undefined',
          attributes: { 'data-path-param': match.name },
        })
      )
    }
  }

  return builder.finish()
}

function findPathParamMatches(text: string): PathParamMatch[] {
  const pathRange = getPathRange(text)
  if (!pathRange) {
    return []
  }

  const matches: PathParamMatch[] = []
  const pathText = text.slice(pathRange.start, pathRange.end)
  const pathSegments = pathText.split('/')
  let offset = pathRange.start

  for (const segment of pathSegments) {
    const match = segment.match(/^:([A-Za-z0-9._-]+)$/)
    if (match?.[1]) {
      matches.push({ index: offset, length: segment.length, name: match[1] })
    }

    offset += segment.length + 1
  }

  return matches
}

function getPathRange(text: string) {
  const suffixMatch = text.match(/[?#]/)
  const end = suffixMatch ? suffixMatch.index ?? text.length : text.length
  const target = text.slice(0, end)
  const protocolMatch = target.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//)

  if (protocolMatch) {
    const authorityStart = protocolMatch[0].length
    const pathStartInTarget = target.indexOf('/', authorityStart)
    if (pathStartInTarget < 0) {
      return null
    }

    return { start: pathStartInTarget, end }
  }

  return { start: 0, end }
}

function getPathParamAtPosition(view: EditorView, pos: number, side: number) {
  const line = view.state.doc.lineAt(pos)

  for (const match of findPathParamMatches(line.text)) {
    const from = line.from + match.index
    const to = from + match.length
    const inside = side < 0 ? pos > from && pos <= to : pos >= from && pos < to
    if (inside) {
      return { from, to, name: match.name }
    }
  }

  return null
}
