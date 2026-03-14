import { createRoot } from 'react-dom/client'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, hoverTooltip, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { VariableHoverTooltip, type VariableTooltipEnvironmentRow } from './VariableHoverTooltip'

const variableRegexp = /\\?\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g

type VariableTooltipEnvironment = {
  id: string
  name: string
  isActive: boolean
  priority: number
  createdAt: number
  valueByVariableName: Map<string, string>
}

export function variableHighlightExtension({
  getDefinedVariableNames,
  getEnvironments,
  onToggleEnvironment,
  onOpenEnvironment,
  onChangeValue,
  onSaveValue,
}: {
  getDefinedVariableNames: () => Iterable<string>
  getEnvironments: () => VariableTooltipEnvironment[]
  onToggleEnvironment: (environmentId: string) => void
  onOpenEnvironment: (environmentId: string) => void
  onChangeValue: (environmentId: string, variableName: string, value: string) => void
  onSaveValue: (environmentId: string) => Promise<void> | void
}): Extension {
  return [
    EditorView.baseTheme({
      '.cm-template-variable': {
        borderRadius: '0.375rem',
        padding: '0.05rem 0.2rem',
        border: '1px solid transparent',
        transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease',
      },
      '.cm-template-variable-defined': {
        color: 'color-mix(in oklab, var(--color-info) 78%, var(--color-base-content) 22%) !important',
        backgroundColor: 'color-mix(in oklab, var(--color-info) 24%, transparent) !important',
        borderColor: 'color-mix(in oklab, var(--color-info) 46%, transparent) !important',
        boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--color-info) 58%, transparent)',
      },
      '.cm-template-variable-undefined': {
        color: 'color-mix(in oklab, var(--color-error) 82%, var(--color-base-content) 18%) !important',
        backgroundColor: 'color-mix(in oklab, var(--color-error) 18%, transparent) !important',
        borderColor: 'color-mix(in oklab, var(--color-error) 40%, transparent) !important',
        boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--color-error) 56%, transparent)',
      },
    }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, getDefinedVariableNames)
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
            this.decorations = buildDecorations(update.view, getDefinedVariableNames)
          }
        }
      },
      {
        decorations: value => value.decorations,
      }
    ),
    hoverTooltip(
      (view, pos, side) => {
        const match = getVariableAtPosition(view, pos, side)
        if (!match) {
          return null
        }

        const tooltipRows: VariableTooltipEnvironmentRow[] = getEnvironments().map(environment => ({
          id: environment.id,
          name: environment.name,
          isActive: environment.isActive,
          value: environment.valueByVariableName.get(match.variableName) ?? '',
          isEffective: isEffectiveVariableSource(getEnvironments(), environment.id, match.variableName),
        }))

        return {
          pos: match.from,
          end: match.to,
          above: false,
          create() {
            const dom = document.createElement('div')
            const root = createRoot(dom)

            root.render(
              <VariableHoverTooltip
                variableName={match.variableName}
                rows={tooltipRows}
                onToggleEnvironment={onToggleEnvironment}
                onOpenEnvironment={onOpenEnvironment}
                onChangeValue={(environmentId, value) => onChangeValue(environmentId, match.variableName, value)}
                onSaveValue={onSaveValue}
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
      { hoverTime: 150 }
    ),
  ]
}

function buildDecorations(view: EditorView, getDefinedVariableNames: () => Iterable<string>) {
  const builder = new RangeSetBuilder<Decoration>()
  const definedVariables = new Set(Array.from(getDefinedVariableNames(), variableName => variableName.trim()).filter(Boolean))

  for (const { from, to } of view.visibleRanges) {
    variableRegexp.lastIndex = 0

    const text = view.state.doc.sliceString(from, to)
    let match: RegExpExecArray | null

    while ((match = variableRegexp.exec(text)) !== null) {
      if (match[0].startsWith('\\')) {
        continue
      }

      const variableName = match[1]?.trim()
      if (!variableName) {
        continue
      }

      const start = from + match.index
      const decoration = Decoration.mark({
        class: definedVariables.has(variableName)
          ? 'cm-template-variable cm-template-variable-defined'
          : 'cm-template-variable cm-template-variable-undefined',
        attributes: { 'data-template-variable': variableName },
      })

      builder.add(start, start + match[0].length, decoration)
    }
  }

  return builder.finish()
}

function getVariableAtPosition(view: EditorView, pos: number, side: number) {
  const line = view.state.doc.lineAt(pos)
  variableRegexp.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = variableRegexp.exec(line.text)) !== null) {
    if (match[0].startsWith('\\')) {
      continue
    }

    const from = line.from + match.index
    const to = from + match[0].length
    const inside = side < 0 ? pos > from && pos <= to : pos >= from && pos < to
    if (!inside) {
      continue
    }

    const variableName = match[1]?.trim()
    if (!variableName) {
      return null
    }

    return { from, to, variableName }
  }

  return null
}

function isEffectiveVariableSource(environments: VariableTooltipEnvironment[], environmentId: string, variableName: string) {
  const activeCandidates = environments
    .filter(environment => environment.isActive && environment.valueByVariableName.has(variableName))
    .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)

  return activeCandidates[0]?.id === environmentId
}
