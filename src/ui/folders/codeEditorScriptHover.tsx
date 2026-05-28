import { StateEffect, StateField, type Extension, type SelectionRange } from '@codemirror/state'
import { EditorView, hoverTooltip, keymap, showTooltip, type Tooltip } from '@codemirror/view'
import type { SharedScriptTarget } from '@common/SharedScripts'
import { requestScriptHover } from './scriptAutocompleteClient'
import type {
  ScriptAutocompletePackage,
  ScriptAutocompleteSharedScript,
  ScriptHoverInfo,
  ScriptHoverPart,
  ScriptHoverTag,
} from './scriptAutocompleteTypes'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'

type ScriptHoverOptions = {
  phase?: ScriptAutocompletePhase
  targets?: SharedScriptTarget[]
  getRequestPaths?: () => string[][]
  getSharedScripts?: () => ScriptAutocompleteSharedScript[]
  getPackages?: () => ScriptAutocompletePackage[]
}

const setScriptHoverTooltipEffect = StateEffect.define<Tooltip | null>()
const scriptHoverControllers = new WeakMap<EditorView, () => boolean>()

const scriptHoverTooltipField = StateField.define<Tooltip | null>({
  create() {
    return null
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setScriptHoverTooltipEffect)) {
        return effect.value
      }
    }

    if (transaction.docChanged || transaction.selection) {
      return null
    }

    return value
  },
  provide: field => showTooltip.from(field),
})

export function scriptHoverExtension(options: ScriptHoverOptions): Extension {
  const runtimeContext = options.targets ? { targets: options.targets } : { phase: options.phase ?? 'pre-request' }

  const loadHover = async (view: EditorView, position: number) => {
    if (!isHoverableScriptPosition(view.state.doc.toString(), position)) {
      return null
    }

    const result = await requestScriptHover({
      runtimeContext,
      code: view.state.doc.toString(),
      position,
      requestPaths: options.getRequestPaths?.(),
      sharedScripts: options.getSharedScripts?.(),
      packages: options.getPackages?.(),
    })

    return result?.hover ?? null
  }

  const registerController = EditorView.updateListener.of(update => {
    if (!update.view.dom.isConnected) {
      scriptHoverControllers.delete(update.view)
      return
    }

    scriptHoverControllers.set(update.view, () => {
      void showHoverAtSelection(update.view, loadHover)
      return true
    })
  })

  return [
    scriptHoverTooltipField,
    hoverTooltip(
      async (view, pos) => {
        const hover = await loadHover(view, pos)
        return hover ? createScriptHoverTooltip(hover) : null
      },
      { hoverTime: 200 }
    ),
    EditorView.domEventHandlers({
      blur(_event, view) {
        if (view.state.field(scriptHoverTooltipField, false)) {
          view.dispatch({ effects: setScriptHoverTooltipEffect.of(null) })
        }
      },
    }),
    keymap.of([
      {
        key: 'Escape',
        run(view) {
          if (!view.state.field(scriptHoverTooltipField, false)) {
            return false
          }

          view.dispatch({ effects: setScriptHoverTooltipEffect.of(null) })
          return true
        },
      },
    ]),
    registerController,
  ]
}

export function showScriptHoverForEditor(view: EditorView) {
  const controller = scriptHoverControllers.get(view)
  if (!controller) {
    return false
  }

  return controller()
}

async function showHoverAtSelection(
  view: EditorView,
  loadHover: (view: EditorView, position: number) => Promise<ScriptHoverInfo | null>
) {
  const selection = view.state.selection.main
  if (!selection.empty) {
    return
  }

  const hover = await loadHover(view, getSelectionHoverPosition(selection))
  if (!hover || !view.dom.isConnected) {
    return
  }

  view.dispatch({ effects: setScriptHoverTooltipEffect.of(createScriptHoverTooltip(hover)) })
}

function getSelectionHoverPosition(selection: SelectionRange) {
  return Math.max(0, selection.head)
}

function createScriptHoverTooltip(hover: ScriptHoverInfo): Tooltip {
  return {
    pos: hover.from,
    end: hover.to,
    above: true,
    strictSide: false,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-script-hover'

      const detail = document.createElement('pre')
      detail.className = 'cm-script-hover-detail'
      appendParts(detail, hover.detailParts)
      dom.append(detail)

      if (hover.documentationParts.length > 0) {
        const documentation = document.createElement('div')
        documentation.className = 'cm-script-hover-documentation'
        appendDocumentation(documentation, hover.documentationParts)
        dom.append(documentation)
      }

      if (hover.tags.length > 0) {
        const tags = document.createElement('div')
        tags.className = 'cm-script-hover-tags'
        for (const tag of hover.tags) {
          tags.append(createTagRow(tag))
        }
        dom.append(tags)
      }

      return { dom }
    },
  }
}

function appendDocumentation(parent: HTMLElement, parts: ScriptHoverPart[]) {
  for (const line of partsToText(parts).split('\n')) {
    const paragraph = document.createElement('p')
    paragraph.className = 'cm-script-hover-paragraph'
    paragraph.textContent = line
    parent.append(paragraph)
  }
}

function createTagRow(tag: ScriptHoverTag) {
  const row = document.createElement('div')
  row.className = 'cm-script-hover-tag'

  const label = document.createElement('span')
  label.className = 'cm-script-hover-tag-label'
  label.textContent = `@${tag.name}`
  row.append(label)

  if (tag.textParts.length > 0) {
    const content = document.createElement('span')
    content.className = 'cm-script-hover-tag-text'
    appendParts(content, tag.textParts)
    row.append(content)
  }

  return row
}

function appendParts(parent: HTMLElement, parts: ScriptHoverPart[]) {
  for (const part of parts) {
    const span = document.createElement('span')
    span.className = getPartClassName(part)
    span.textContent = part.text
    parent.append(span)
  }
}

function partsToText(parts: ScriptHoverPart[]) {
  return parts.map(part => part.text).join('')
}

function getPartClassName(part: ScriptHoverPart) {
  switch (part.kind) {
    case 'keyword':
      return 'cm-script-hover-part cm-script-hover-part-keyword'
    case 'stringLiteral':
    case 'string':
      return 'cm-script-hover-part cm-script-hover-part-string'
    case 'numericLiteral':
      return 'cm-script-hover-part cm-script-hover-part-number'
    case 'parameterName':
    case 'localName':
      if (/^[A-Z_$][\w$]*$/.test(part.text)) {
        return 'cm-script-hover-part cm-script-hover-part-type'
      }

      return 'cm-script-hover-part cm-script-hover-part-variable'
    case 'propertyName':
    case 'methodName':
    case 'functionName':
      if (/^[A-Z_$][\w$]*$/.test(part.text)) {
        return 'cm-script-hover-part cm-script-hover-part-type'
      }

      return 'cm-script-hover-part cm-script-hover-part-property'
    case 'interfaceName':
    case 'className':
    case 'aliasName':
    case 'typeParameterName':
    case 'enumName':
    case 'enumMemberName':
    case 'moduleName':
    case 'namespaceName':
      return 'cm-script-hover-part cm-script-hover-part-type'
    case 'punctuation':
      return 'cm-script-hover-part cm-script-hover-part-punctuation'
    default:
      return getFallbackPartClassName(part.text)
  }
}

function getFallbackPartClassName(text: string) {
  if (/^(string|number|boolean|bigint|symbol|object|unknown|void|undefined|null|never|true|false)$/.test(text)) {
    return 'cm-script-hover-part cm-script-hover-part-keyword'
  }

  if (/^[A-Z_$][\w$]*$/.test(text)) {
    return 'cm-script-hover-part cm-script-hover-part-type'
  }

  return 'cm-script-hover-part'
}

function isHoverableScriptPosition(source: string, position: number) {
  const current = source.charAt(position)
  const previous = source.charAt(Math.max(0, position - 1))

  return isIdentifierChar(current) || isIdentifierChar(previous)
}

function isIdentifierChar(character: string) {
  return /^[A-Za-z0-9_$]$/.test(character)
}
