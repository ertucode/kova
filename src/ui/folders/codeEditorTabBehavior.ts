import { acceptCompletion, completionStatus } from '@codemirror/autocomplete'
import { indentLess, indentMore } from '@codemirror/commands'
import { Prec, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { getCM } from '@replit/codemirror-vim'

type CodeEditorTabBehaviorOptions = {
  fallbackToBrowserTab?: boolean
}

const tabbableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ')

export function codeEditorTabBehaviorExtension(options?: CodeEditorTabBehaviorOptions): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'Tab',
        run: (view: EditorView) => {
          const vimState = getCM(view)?.state.vim
          const isNormalMode = Boolean(vimState && !vimState.insertMode && !vimState.visualMode)

          if (isNormalMode) {
            return focusRelativeTabTarget(view, 1)
          }

          if (completionStatus(view.state) === 'active' && acceptCompletion(view)) {
            return true
          }

          if (!options?.fallbackToBrowserTab) {
            return indentMore(view)
          }

          return focusRelativeTabTarget(view, 1)
        },
      },
      {
        key: 'Shift-Tab',
        run: (view: EditorView) => {
          const vimState = getCM(view)?.state.vim
          const isNormalMode = Boolean(vimState && !vimState.insertMode && !vimState.visualMode)

          if (isNormalMode) {
            return focusRelativeTabTarget(view, -1)
          }
          if (!options?.fallbackToBrowserTab) {
            return indentLess(view)
          }

          return focusRelativeTabTarget(view, -1)
        },
      },
    ])
  )
}

function focusRelativeTabTarget(view: EditorView, direction: 1 | -1) {
  const document = view.dom.ownerDocument
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) {
    return false
  }

  const tabbableElements = Array.from(document.querySelectorAll<HTMLElement>(tabbableSelector)).filter(isTabbable)
  const currentIndex = tabbableElements.findIndex(
    element => element === activeElement || element.contains(activeElement)
  )
  if (currentIndex === -1) {
    return false
  }

  const nextElement = tabbableElements[currentIndex + direction]
  if (!nextElement) {
    return false
  }

  nextElement.focus()
  return true
}

function isTabbable(element: HTMLElement) {
  if (element.tabIndex < 0 || element.getAttribute('aria-hidden') === 'true') {
    return false
  }

  if (element instanceof HTMLInputElement && element.type === 'hidden') {
    return false
  }

  return !element.matches(':disabled') && !isHidden(element)
}

function isHidden(element: HTMLElement) {
  if (element.hidden) {
    return true
  }

  const style = window.getComputedStyle(element)
  return style.display === 'none' || style.visibility === 'hidden'
}
