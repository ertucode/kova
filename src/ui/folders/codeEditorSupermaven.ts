import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'
import type { SharedScriptTarget } from '@common/SharedScripts'
import { getWindowElectron } from '@/getWindowElectron'
import { getSupermavenEnabled } from '@/global/appSettingsStore'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import { defaultSettingsTokyoNight } from '@uiw/codemirror-theme-tokyo-night'

type SupermavenGhostSuggestion = {
  text: string
  deleteCount: number
  position: number
}

type SupermavenExtensionOptions = {
  getDocumentPath: () => string
  phase?: ScriptAutocompletePhase
  targets?: SharedScriptTarget[]
}

const SUPERMAVEN_DEBOUNCE_MS = 250
const setGhostSuggestionEffect = StateEffect.define<SupermavenGhostSuggestion | null>()
const ghostTheme = EditorView.theme({
  '.cm-supermaven-ghost': {
    color: 'color-mix(in oklab, var(--color-base-content) 38%, transparent)',
    backgroundColor: defaultSettingsTokyoNight.background!,
    whiteSpace: 'pre',
    pointerEvents: 'none',
    fontStyle: 'italic',
    position: 'relative',
    zIndex: '2',
  },
})

const ghostSuggestionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGhostSuggestionEffect)) {
        const suggestion = effect.value
        if (!suggestion) {
          return Decoration.none
        }

        return Decoration.set([
          Decoration.widget({
            widget: new SupermavenGhostWidget(suggestion.text),
            side: 1,
          }).range(suggestion.position),
        ])
      }
    }

    if (transaction.docChanged || transaction.selection) {
      return Decoration.none
    }

    return decorations
  },
  provide: field => EditorView.decorations.from(field),
})

export function supermavenGhostCompletionExtension(options: SupermavenExtensionOptions): Extension {
  return [
    ghostSuggestionField,
    ghostTheme,
    EditorView.domEventHandlers({
      mousedown(_event, view) {
        const pluginState = getSupermavenGhostState(view)
        pluginState.pendingPointerTrigger = getSupermavenEnabled() && isInsertMode(view)
        return false
      },
      keydown(event, view) {
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.altKey && event.code === 'KeyL') {
          event.preventDefault()
          event.stopPropagation()
          requestSuggestionNow(view, options)
          return true
        }

        if (event.key !== 'Escape') {
          return false
        }

        const pluginState = getSupermavenGhostState(view)
        if (!pluginState.suggestion) {
          return false
        }

        event.preventDefault()
        clearSuggestion(view)
        return true
      },
    }),
    EditorView.updateListener.of(update => {
      const pluginState = getSupermavenGhostState(update.view)
      const insertMode = isInsertMode(update.view)
      const hasUserInput = update.transactions.some(transaction => transaction.isUserEvent('input'))

      if (update.docChanged || update.selectionSet) {
        pluginState.requestVersion += 1
        if (pluginState.suggestion) {
          clearSuggestion(update.view)
        }
      }

      if (!getSupermavenEnabled() || !insertMode) {
        cancelPendingSuggestion(update.view)
        pluginState.wasInsertMode = insertMode
        return
      }

      if (hasUserInput) {
        scheduleSuggestionRequest(update.view, options)
        pluginState.wasInsertMode = insertMode
        return
      }

      if (update.selectionSet && !pluginState.wasInsertMode && insertMode) {
        scheduleSuggestionRequest(update.view, options)
        pluginState.pendingPointerTrigger = false
        pluginState.wasInsertMode = insertMode
        return
      }

      if (update.selectionSet && pluginState.pendingPointerTrigger && update.state.selection.main.empty) {
        scheduleSuggestionRequest(update.view, options)
        pluginState.pendingPointerTrigger = false
        pluginState.wasInsertMode = insertMode
        return
      }

      if (update.selectionSet && !update.state.selection.main.empty) {
        cancelPendingSuggestion(update.view)
      }

      if (!update.selectionSet) {
        pluginState.pendingPointerTrigger = false
      }

      pluginState.wasInsertMode = insertMode
    }),
  ]
}

type SupermavenGhostState = {
  suggestion: SupermavenGhostSuggestion | null
  requestVersion: number
  timeoutId: number | null
  wasInsertMode: boolean
  pendingPointerTrigger: boolean
}

function getSupermavenGhostState(view: EditorView) {
  const nextView = view as EditorView & { __kovaSupermavenGhostState?: SupermavenGhostState }
  nextView.__kovaSupermavenGhostState ??= {
    suggestion: null,
    requestVersion: 0,
    timeoutId: null,
    wasInsertMode: isInsertMode(view),
    pendingPointerTrigger: false,
  }
  return nextView.__kovaSupermavenGhostState
}

function scheduleSuggestionRequest(view: EditorView, options: SupermavenExtensionOptions) {
  const pluginState = getSupermavenGhostState(view)
  if (pluginState.timeoutId !== null) {
    window.clearTimeout(pluginState.timeoutId)
  }

  pluginState.timeoutId = window.setTimeout(() => {
    pluginState.timeoutId = null
    requestSuggestionNow(view, options)
  }, SUPERMAVEN_DEBOUNCE_MS)
}

function cancelPendingSuggestion(view: EditorView) {
  const pluginState = getSupermavenGhostState(view)
  if (pluginState.timeoutId === null) {
    return
  }

  window.clearTimeout(pluginState.timeoutId)
  pluginState.timeoutId = null
}

function requestSuggestionNow(view: EditorView, options: SupermavenExtensionOptions) {
  const pluginState = getSupermavenGhostState(view)
  const activeSuggestion = pluginState.suggestion
  if (activeSuggestion) {
    acceptSuggestion(view, activeSuggestion, options)
    pluginState.suggestion = null
    return
  }

  if (!getSupermavenEnabled() || !isInsertMode(view) || !view.state.selection.main.empty) {
    clearSuggestion(view)
    return
  }

  cancelPendingSuggestion(view)
  void requestSuggestion(view, options)
}

async function requestSuggestion(view: EditorView, options: SupermavenExtensionOptions) {
  const pluginState = getSupermavenGhostState(view)
  pluginState.requestVersion += 1
  const requestVersion = pluginState.requestVersion
  const content = view.state.doc.toString()
  const cursorOffset = view.state.selection.main.head
  const documentPath = options.getDocumentPath()

  const result = await getWindowElectron().requestSupermavenInlineSuggestion({
    documentPath,
    content,
    cursorOffset,
    phase: options.phase,
    targets: options.targets,
  })

  if (
    !view.dom.isConnected ||
    requestVersion !== pluginState.requestVersion ||
    view.state.doc.toString() !== content ||
    view.state.selection.main.head !== cursorOffset
  ) {
    return
  }

  if (!result.success || !result.data || result.data.text.trim() === '') {
    clearSuggestion(view)
    return
  }

  const suggestion: SupermavenGhostSuggestion = {
    text: result.data.text,
    deleteCount: result.data.deleteCount,
    position: cursorOffset,
  }

  pluginState.suggestion = suggestion
  view.dispatch({
    effects: setGhostSuggestionEffect.of(suggestion),
  })
}

function clearSuggestion(view: EditorView) {
  const pluginState = getSupermavenGhostState(view)
  pluginState.suggestion = null
  view.dispatch({
    effects: setGhostSuggestionEffect.of(null),
  })
}

function acceptSuggestion(
  view: EditorView,
  suggestion: SupermavenGhostSuggestion,
  options: SupermavenExtensionOptions
) {
  const from = Math.max(0, suggestion.position - suggestion.deleteCount)
  const replacement = suggestion.text
  view.dispatch({
    changes: { from, to: suggestion.position, insert: replacement },
    selection: { anchor: from + replacement.length },
    effects: setGhostSuggestionEffect.of(null),
  })

  if (getSupermavenEnabled() && isInsertMode(view) && view.state.selection.main.empty) {
    scheduleSuggestionRequest(view, options)
  }
}

class SupermavenGhostWidget extends WidgetType {
  constructor(private readonly text: string) {
    super()
  }

  override eq(other: SupermavenGhostWidget) {
    return other.text === this.text
  }

  override toDOM() {
    const element = document.createElement('span')
    element.className = 'cm-supermaven-ghost'
    element.textContent = this.text
    element.setAttribute('aria-hidden', 'true')
    return element
  }

  override ignoreEvent() {
    return true
  }
}

function isInsertMode(view: EditorView) {
  const vimState = getCM(view)?.state.vim
  if (!vimState) {
    return true
  }

  return Boolean(vimState.insertMode)
}
