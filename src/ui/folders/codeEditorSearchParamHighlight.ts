import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

type SearchParamSegment = {
  from: number
  to: number
  className: string
}

export function searchParamHighlightExtension(): Extension {
  return [
    EditorView.baseTheme({
      '.cm-search-param-key': {
        color: 'var(--color-warning) !important',
      },
      '.cm-search-param-value': {
        color: '#ffffff !important',
      },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view)
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
            this.decorations = buildDecorations(update.view)
          }
        }
      },
      {
        decorations: value => value.decorations,
      }
    ),
  ]
}

function buildDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)

    for (const segment of findSearchParamSegments(text)) {
      builder.add(
        from + segment.from,
        from + segment.to,
        Decoration.mark({
          class: segment.className,
        })
      )
    }
  }

  return builder.finish()
}

function findSearchParamSegments(text: string): SearchParamSegment[] {
  const queryStart = text.indexOf('?')
  if (queryStart < 0) {
    return []
  }

  const hashStart = text.indexOf('#', queryStart + 1)
  const queryEnd = hashStart >= 0 ? hashStart : text.length
  const segments: SearchParamSegment[] = []

  let cursor = queryStart + 1

  while (cursor < queryEnd) {
    const pairEnd = text.indexOf('&', cursor)
    const nextCursor = pairEnd >= 0 && pairEnd < queryEnd ? pairEnd : queryEnd
    const pair = text.slice(cursor, nextCursor)

    if (pair.length > 0) {
      const equalsIndex = pair.indexOf('=')

      if (equalsIndex < 0) {
        segments.push({
          from: cursor,
          to: nextCursor,
          className: 'cm-search-param-key',
        })
      } else {
        if (equalsIndex > 0) {
          segments.push({
            from: cursor,
            to: cursor + equalsIndex,
            className: 'cm-search-param-key',
          })
        }

        if (equalsIndex < pair.length - 1) {
          segments.push({
            from: cursor + equalsIndex + 1,
            to: nextCursor,
            className: 'cm-search-param-value',
          })
        }
      }
    }

    cursor = nextCursor + 1
  }

  return segments
}
