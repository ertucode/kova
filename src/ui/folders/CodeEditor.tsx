import { createElement, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { toggleBlockComment, toggleLineComment } from '@codemirror/commands'
import { highlightSelectionMatches } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, foldGutter, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { forEachDiagnostic, lintGutter } from '@codemirror/lint'
import { json } from '@codemirror/lang-json'
import { json5 as json5Language } from 'codemirror-json5'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { EditorView, keymap, lineNumbers, placeholder as placeholderExtension } from '@codemirror/view'
import CodeMirror, { basicSetup as codeMirrorBasicSetup } from '@uiw/react-codemirror'
import type { SyntaxNode } from '@lezer/common'
import { tags } from '@lezer/highlight'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { twMerge } from 'tailwind-merge'
import { Vim, getCM, vim } from '@replit/codemirror-vim'
import { useSelector } from '@xstate/store/react'
import { DEFAULT_VIM_MODE } from '@common/AppSettings'
import { appSettingsStore } from '@/global/appSettingsStore'

export type CodeEditorLanguage = 'plain' | 'json' | 'json5' | 'javascript' | 'jsx' | 'html' | 'css' | 'xml'

export type CodeEditorHandle = {
  focusLine: (line: number, column?: number | null) => void
  setSelection: (selection: CodeEditorSelection) => void
}

export type CodeEditorPasteParams = {
  text: string
  value: string
  selectionFrom: number
  selectionTo: number
  selectedText: string
}

export type CodeEditorSelection = {
  anchor: number
  head: number
}

const selectionMatchesExtension = highlightSelectionMatches({ highlightWordAroundCursor: true })
const baseSetupExtensions = codeMirrorBasicSetup({
  lineNumbers: false,
  foldGutter: false,
  dropCursor: false,
  allowMultipleSelections: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  searchKeymap: true,
})
const selectionMatchTheme = EditorView.theme({
  '& .cm-selectionMatch-main': {
    backgroundColor: 'transparent !important',
  },
})
const hideFocusOutlineTheme = EditorView.theme({
  '&.cm-focused': {
    outline: 'none !important',
  },
})
const singleLineContentTheme = EditorView.theme({
  '& .cm-content': {
    minHeight: 'auto',
    width: '100%',
    paddingTop: '0.75rem !important',
    paddingBottom: '0.75rem !important',
  },
})
const singleLineTransactionFilter = EditorState.transactionFilter.of(transaction => {
  if (!transaction.docChanged) {
    return transaction
  }

  const nextText = transaction.newDoc.toString()
  if (!nextText.includes('\n')) {
    return transaction
  }

  return [
    transaction,
    { changes: { from: 0, to: transaction.newDoc.length, insert: nextText.replace(/\s*\n\s*/g, ' ') } },
  ]
})
const readOnlyExtension = EditorState.readOnly.of(true)
const tabSizeExtension = EditorState.tabSize.of(2)
const foldGutterExtension = foldGutter({ markerDOM: open => createFoldMarker(open) })
const lintGutterExtension = lintGutter()
const lineNumbersExtension = lineNumbers()
const vimExtension = vim()
const commentKeymapExtension = keymap.of([
  { key: 'Mod-Shift-K', run: toggleLineComment },
  { key: 'Mod-Shift-B', run: runBlockCommentCommand },
])
const jsonLanguageExtension = json()
const json5LanguageExtension = json5Language()
const json5CommentTokensExtension = json5LanguageExtension.language.data.of({
  commentTokens: {
    line: '//',
    block: { open: '/*', close: '*/' },
  },
})
const javascriptLanguageExtension = javascript({ typescript: true })
const jsxLanguageExtension = javascript({ jsx: true, typescript: true })
const htmlLanguageExtension = html()
const cssLanguageExtension = css()
const xmlLanguageExtension = xml()

const editorHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--color-primary)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-accent)' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: 'var(--color-info)' },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: 'color-mix(in oklab, var(--color-base-content) 92%, var(--color-accent) 8%)',
  },
  { tag: [tags.variableName, tags.labelName], color: 'var(--color-base-content)' },
  {
    tag: [tags.comment],
    color: 'color-mix(in oklab, var(--color-base-content) 45%, transparent)',
    fontStyle: 'italic',
  },
  {
    tag: [tags.operator, tags.punctuation, tags.separator],
    color: 'color-mix(in oklab, var(--color-base-content) 68%, transparent)',
  },
  {
    tag: [tags.brace, tags.squareBracket, tags.paren],
    color: 'color-mix(in oklab, var(--color-base-content) 76%, transparent)',
  },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.875rem',
    backgroundColor: 'transparent !important',
    color: 'var(--color-base-content)',
  },
  '&.cm-editor': {
    height: '100%',
    backgroundColor: 'transparent !important',
    overflow: 'visible',
    position: 'relative',
  },
  '&.cm-focused': {
    outline: '2px solid var(--color-base-content)',
    outlineOffset: '-2px',
  },
  '.cm-scroller, .cm-layer': {
    backgroundColor: 'transparent !important',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent !important',
    borderRight: '1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent)',
    paddingRight: '0',
  },
  '.cm-gutter-lint': {
    width: '1.05rem',
  },
  '.cm-gutter-lint .cm-gutterElement': {
    alignItems: 'center',
    display: 'flex',
    padding: '0',
    width: '1.05rem',
    justifyContent: 'center',
  },
  '.cm-gutter-lint .cm-lint-marker': {
    display: 'block',
    flex: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    alignItems: 'center',
    display: 'flex',
    minWidth: '1rem',
    padding: '0 0.2rem 0 0.3rem',
  },
  '.cm-foldGutter': {
    width: '1.5rem',
  },
  '.cm-foldGutter .cm-gutterElement': {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'center',
    padding: '0',
    transition: 'color 120ms ease',
  },
  '.cm-foldGutter .cm-gutterElement > span': {
    alignItems: 'center',
    display: 'inline-flex',
    justifyContent: 'center',
  },
  '.cm-foldPlaceholder': {
    border: '1px solid color-mix(in oklab, var(--color-base-content) 14%, transparent)',
    backgroundColor: 'color-mix(in oklab, var(--color-base-200) 84%, transparent)',
    color: 'color-mix(in oklab, var(--color-base-content) 58%, transparent)',
    borderRadius: '999px',
    padding: '0 0.35rem',
  },
  '.cm-gutterElement': {
    color: 'color-mix(in oklab, var(--color-base-content) 42%, transparent)',
    boxSizing: 'border-box',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: 'var(--color-base-content)',
  },
  '.cm-tooltipLayer': {
    overflow: 'visible',
    zIndex: '9999',
  },
  '.cm-scroller': {
    height: '100%',
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content, .cm-gutter': {
    minHeight: '100%',
  },
  '.cm-content': {
    padding: '0.75rem 0.75rem 0.75rem 0.5rem',
    fontFamily:
      'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
    lineHeight: '1.5rem',
    caretColor: 'var(--color-base-content) !important',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftWidth: '1.5px !important',
    borderLeftColor: 'var(--color-base-content) !important',
  },
  '.cm-fat-cursor': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-content) 82%, var(--color-primary) 18%) !important',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none !important',
    outline: 'solid 1px color-mix(in oklab, var(--color-base-content) 82%, var(--color-primary) 18%) !important',
    color: 'transparent !important',
  },
  '.cm-placeholder': {
    color: 'color-mix(in oklab, var(--color-base-content) 34%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--color-base-200)',
    color: 'var(--color-base-content)',
    borderTop: '1px solid color-mix(in oklab, var(--color-base-content) 10%, transparent)',
  },
  '.cm-search': {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    padding: '0.75rem',
  },
  '.cm-search label': {
    alignItems: 'center',
    color: 'color-mix(in oklab, var(--color-base-content) 72%, transparent)',
    display: 'inline-flex',
    fontSize: '0.8rem',
    gap: '0.35rem',
  },
  '.cm-search input[type="checkbox"]': {
    accentColor: 'var(--color-primary)',
  },
  '.cm-search .cm-textfield': {
    appearance: 'none',
    backgroundColor: 'var(--color-base-100)',
    border: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)',
    borderRadius: '0.5rem',
    color: 'var(--color-base-content)',
    minHeight: '2rem',
    padding: '0.35rem 0.65rem',
  },
  '.cm-search .cm-textfield::placeholder': {
    color: 'color-mix(in oklab, var(--color-base-content) 34%, transparent)',
  },
  '.cm-search .cm-textfield:focus': {
    borderColor: 'color-mix(in oklab, var(--color-primary) 55%, var(--color-base-content) 12%)',
    boxShadow: '0 0 0 3px color-mix(in oklab, var(--color-primary) 18%, transparent)',
    outline: 'none',
  },
  '.cm-search .cm-button': {
    appearance: 'none',
    backgroundColor: 'var(--color-base-100)',
    border: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)',
    borderRadius: '0.5rem',
    color: 'var(--color-base-content)',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: '2rem',
    padding: '0.35rem 0.7rem',
    transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
  },
  '.cm-search .cm-button:hover': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-100) 82%, var(--color-primary) 18%)',
    borderColor: 'color-mix(in oklab, var(--color-primary) 30%, var(--color-base-content) 12%)',
  },
  '.cm-search .cm-button:focus-visible': {
    borderColor: 'color-mix(in oklab, var(--color-primary) 55%, var(--color-base-content) 12%)',
    boxShadow: '0 0 0 3px color-mix(in oklab, var(--color-primary) 18%, transparent)',
    outline: 'none',
  },
  '.cm-search .cm-button[disabled]': {
    cursor: 'not-allowed',
    opacity: '0.5',
  },
  '.cm-search .cm-searchMatch': {
    color: 'color-mix(in oklab, var(--color-base-content) 58%, transparent)',
    fontSize: '0.8rem',
    marginLeft: '0.25rem',
  },
  '.cm-tooltip': {
    border: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)',
    backgroundColor: 'var(--color-base-200)',
    color: 'var(--color-base-content)',
    pointerEvents: 'auto',
    padding: '0',
    overflow: 'hidden',
    zIndex: '9999',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    maxWidth: '34rem',
    fontFamily: 'inherit',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li': {
    borderTop: '1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent)',
    padding: '0.5rem 0.75rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li:first-child': {
    borderTop: '0',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'color-mix(in oklab, var(--color-info) 16%, transparent)',
    color: 'var(--color-base-content)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li .cm-completionLabel': {
    fontWeight: '600',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li .cm-completionIcon': {
    display: 'none',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li .cm-completionDetail': {
    color: 'color-mix(in oklab, var(--color-base-content) 58%, transparent)',
    fontStyle: 'normal',
    marginLeft: '0.75rem',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-content) 5%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklab, var(--color-warning) 28%, transparent)',
    borderBottom: '1px solid color-mix(in oklab, var(--color-warning) 62%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 24%, transparent)',
    borderBottom: '1px solid color-mix(in oklab, var(--color-primary) 62%, transparent)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, currentColor 18%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 28%, transparent)',
  },
})

function createScaledEditorTheme(size: 'normal' | 'small', scale: number) {
  const baseFontSizeRem = size === 'small' ? 0.78 : 0.875
  const baseLineHeightRem = size === 'small' ? 1.35 : 1.5
  const scaledFontSizeRem = baseFontSizeRem * scale
  const scaledLineHeightRem = baseLineHeightRem * scale

  return EditorView.theme({
    '&': {
      fontSize: `${scaledFontSizeRem}rem !important`,
    },
    '.cm-scroller': {
      fontSize: `${scaledFontSizeRem}rem !important`,
    },
    '.cm-content': {
      fontSize: `${scaledFontSizeRem}rem !important`,
      lineHeight: `${scaledLineHeightRem}rem !important`,
    },
    '.cm-line': {
      fontSize: `${scaledFontSizeRem}rem !important`,
    },
  })
}

function createFoldMarker(isOpen: boolean) {
  const wrapper = document.createElement('span')
  wrapper.setAttribute('aria-hidden', 'true')

  const iconMarkup = renderToStaticMarkup(
    createElement(isOpen ? ChevronDownIcon : ChevronRightIcon, { size: 14, strokeWidth: 2.2 })
  ).replace('<svg ', '<svg focusable="false" ')

  wrapper.innerHTML = iconMarkup
  return wrapper
}

let diagnosticMappingsInstalled = false
let commentMappingsInstalled = false

function installDiagnosticVimMappings() {
  if (diagnosticMappingsInstalled) return
  diagnosticMappingsInstalled = true

  Vim.defineAction('nextDiagnosticAction', cm => {
    const view = cm.cm6
    if (!view) return
    moveDiagnosticSelection(view, 'next')
    view.focus()
  })

  Vim.defineAction('previousDiagnosticAction', cm => {
    const view = cm.cm6
    if (!view) return
    moveDiagnosticSelection(view, 'previous')
    view.focus()
  })

  Vim.mapCommand(']d', 'action', 'nextDiagnosticAction', undefined, { silent: true })

  Vim.mapCommand('[d', 'action', 'previousDiagnosticAction', undefined, { silent: true })
}

function installCommentVimMappings() {
  if (commentMappingsInstalled) return
  commentMappingsInstalled = true

  Vim.defineAction('toggleLineCommentAction', cm => {
    const view = cm.cm6
    if (!view) return
    toggleLineComment(view)
    view.focus()
  })

  Vim.defineAction('toggleBlockCommentAction', cm => {
    const view = cm.cm6
    if (!view) return
    runBlockCommentCommand(view)
    view.focus()
  })

  Vim.mapCommand('gc', 'action', 'toggleLineCommentAction', undefined, { silent: true, context: 'normal' })
  Vim.mapCommand('gc', 'action', 'toggleLineCommentAction', undefined, { silent: true, context: 'visual' })
  Vim.mapCommand('gb', 'action', 'toggleBlockCommentAction', undefined, { silent: true, context: 'normal' })
  Vim.mapCommand('gb', 'action', 'toggleBlockCommentAction', undefined, { silent: true, context: 'visual' })
}

installDiagnosticVimMappings()
installCommentVimMappings()

function supportsCommentCommands(language: CodeEditorLanguage) {
  return language === 'json5' || language === 'javascript' || language === 'jsx'
}

function runBlockCommentCommand(view: EditorView) {
  const selection = view.state.selection.main
  if (!selection.empty) {
    return toggleBlockComment(view)
  }

  const originalCursor = selection.head

  const commentTokens = view.state.languageDataAt('commentTokens', selection.head, 1)[0] as
    | { block?: { open: string; close: string } }
    | undefined
  const blockTokens = commentTokens?.block
  if (!blockTokens) {
    return toggleBlockComment(view)
  }

  const blockComment = findEnclosingBlockComment(view.state, selection.head)
  if (!blockComment) {
    return toggleBlockComment(view)
  }

  const commentText = view.state.sliceDoc(blockComment.from, blockComment.to)
  if (!commentText.startsWith(blockTokens.open) || !commentText.endsWith(blockTokens.close)) {
    return toggleBlockComment(view)
  }

  const trailingWhitespaceBeforeClose = Number(/\s/.test(commentText.charAt(commentText.length - blockTokens.close.length - 1)))
  const removedRanges = [
    { from: blockComment.from, to: blockComment.from + blockTokens.open.length },
    {
      from: blockComment.to - blockTokens.close.length - trailingWhitespaceBeforeClose,
      to: blockComment.to,
    },
  ]

  let nextCursor = originalCursor
  for (const range of removedRanges) {
    if (nextCursor <= range.from) {
      continue
    }

    if (nextCursor <= range.to) {
      nextCursor = range.from
      continue
    }

    nextCursor -= range.to - range.from
  }

  const innerSelection = {
    anchor: blockComment.from + blockTokens.open.length,
    head: blockComment.to - blockTokens.close.length,
  }

  view.dispatch({ selection: innerSelection })
  const didToggle = toggleBlockComment(view)
  if (!didToggle) {
    return false
  }

  view.dispatch({ selection: { anchor: nextCursor } })
  return true
}

function findEnclosingBlockComment(state: EditorState, position: number) {
  const tree = syntaxTree(state)
  const positions = [position, Math.min(position + 1, state.doc.length), Math.max(position - 1, 0)]
  const sides: Array<-1 | 0 | 1> = [0, 1, -1]

  for (const resolvedPosition of positions) {
    for (const side of sides) {
      let node: SyntaxNode | null = tree.resolveInner(resolvedPosition, side)

      while (node) {
        if (node.type.name === 'BlockComment') {
          return { from: node.from, to: node.to }
        }

        node = node.parent
      }
    }
  }

  return null
}

function moveDiagnosticSelection(view: EditorView, direction: 'next' | 'previous') {
  const diagnostics: Array<{ from: number; to: number }> = []
  forEachDiagnostic(view.state, (_diagnostic, from, to) => {
    diagnostics.push({ from, to })
  })

  if (diagnostics.length === 0) {
    return false
  }

  const selection = view.state.selection.main

  if (direction === 'next') {
    const nextDiagnostic = diagnostics.find(diagnostic => diagnostic.from > selection.to)
    const target = nextDiagnostic ?? diagnostics[0]
    if (!target) {
      return false
    }

    view.dispatch({
      selection: { anchor: target.from },
    })
    centerPositionInView(view, target.from)
    return true
  }

  let previousMatch: { from: number; to: number } | null = null
  for (const diagnostic of diagnostics) {
    if (diagnostic.to < selection.to) {
      previousMatch = diagnostic
      continue
    }

    break
  }

  const target = previousMatch ?? diagnostics[diagnostics.length - 1]
  if (!target) {
    return false
  }

  view.dispatch({
    selection: { anchor: target.from },
  })
  centerPositionInView(view, target.from)
  return true
}

function centerPositionInView(view: EditorView, position: number) {
  window.requestAnimationFrame(() => {
    if (!view.dom.isConnected) {
      return
    }

    const lineBlock = view.lineBlockAt(position)
    const lineCenter = (lineBlock.top + lineBlock.bottom) / 2
    const targetScrollTop = Math.max(0, lineCenter - view.scrollDOM.clientHeight / 2)

    view.scrollDOM.scrollTo({ top: targetScrollTop })
  })
}

export const CodeEditor = memo(function CodeEditor({
  // The props here should also be reflected in response visualizer runtime
  // scriptRuntimeDeclarations.ts
  // scriptDocumentation.ts
  ref,
  testId,
  value,
  language,
  placeholder,
  minHeightClassName,
  className,
  extensions,
  singleLine,
  compact,
  size = 'normal',
  scale = 1,
  hideFocusOutline,
  readOnly,
  showFoldGutter,
  showLineNumbers,
  onPasteText,
  onChange,
  onSelectionChange,
  onBlur,
  initialSelection,
  externalSelection,
  linePaddingOverride,
  vimMode,
  refreshKey,
}: {
  ref?: Ref<CodeEditorHandle>
  testId?: string
  value: string
  language: CodeEditorLanguage
  placeholder?: string
  minHeightClassName?: string
  className?: string
  extensions?: Extension[]
  singleLine?: boolean
  compact?: boolean
  size?: 'normal' | 'small'
  scale?: number
  hideFocusOutline?: boolean
  readOnly?: boolean
  showFoldGutter?: boolean
  showLineNumbers?: boolean
  onPasteText?: (params: CodeEditorPasteParams) => boolean
  onChange: (value: string, params: { caretPos: number; previousValue: string; previousCaretPos: number }) => void
  onSelectionChange?: (selection: CodeEditorSelection) => void
  onBlur?: () => void
  initialSelection?: CodeEditorSelection | null
  externalSelection?: CodeEditorSelection | null
  linePaddingOverride?: string
  vimMode?: boolean
  refreshKey?: string
}) {
  const initialValueRef = useRef(value)
  const editorViewRef = useRef<EditorView | null>(null)
  const vimModeSetting = useSelector(appSettingsStore, state => state.context.settings?.vimMode ?? DEFAULT_VIM_MODE)
  const resolvedVimMode = vimMode ?? vimModeSetting
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onPasteTextRef = useRef(onPasteText)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const lastRefreshKeyRef = useRef(refreshKey)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onBlurRef.current = onBlur
  }, [onBlur])

  useEffect(() => {
    onPasteTextRef.current = onPasteText
  }, [onPasteText])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    const view = editorViewRef.current
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (value === currentValue) {
      return
    }

    const currentSelection = view.state.selection.main
    const nextAnchor = Math.max(
      0,
      Math.min(externalSelection?.anchor ?? currentSelection.anchor, value.length)
    )
    const nextHead = Math.max(0, Math.min(externalSelection?.head ?? currentSelection.head, value.length))

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: { anchor: nextAnchor, head: nextHead },
    })
  }, [externalSelection, value])

  useImperativeHandle(
    ref,
    () => ({
      focusLine(line, column) {
        const view = editorViewRef.current
        if (!view) {
          return
        }

        const clampedLine = Math.max(1, Math.min(line, view.state.doc.lines))
        const lineInfo = view.state.doc.line(clampedLine)
        const nextColumn = Math.max(1, column ?? 1)
        const position = Math.min(lineInfo.from + nextColumn - 1, lineInfo.to)

        view.dispatch({
          selection: { anchor: position },
          scrollIntoView: true,
        })
        view.focus()
      },
      setSelection(selection) {
        const view = editorViewRef.current
        if (!view) {
          return
        }

        const shouldFocus = view.hasFocus
        const anchor = Math.max(0, Math.min(selection.anchor, view.state.doc.length))
        const head = Math.max(0, Math.min(selection.head, view.state.doc.length))

        view.dispatch({
          selection: { anchor, head },
          scrollIntoView: true,
        })
        if (shouldFocus) {
          view.focus()
        }
      },
    }),
    []
  )

  useEffect(() => {
    if (refreshKey === lastRefreshKeyRef.current) {
      return
    }

    lastRefreshKeyRef.current = refreshKey

    const view = editorViewRef.current
    if (!view) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      if (!view.dom.isConnected) {
        return
      }

      view.dispatch({})
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [refreshKey])

  const handleEditorChange = useCallback(
    (nextValue: string, viewUpdate: { state: EditorState; startState: EditorState }) => {
      const caretPos = viewUpdate.state.selection.main.head
      onChangeRef.current(nextValue, {
        caretPos,
        previousValue: viewUpdate.startState.doc.toString(),
        previousCaretPos: viewUpdate.startState.selection.main.head,
      })
    },
    []
  )

  const handleEditorBlur = useCallback(() => {
    onBlurRef.current?.()
  }, [])

  const handleCreateEditor = useCallback(
    (view: EditorView) => {
      editorViewRef.current = view

      const cm = resolvedVimMode ? getCM(view) : null
      if (cm && !readOnly) {
        Vim.handleKey(cm, 'i', 'user')
      }

      if (initialSelection) {
        const anchor = Math.max(0, Math.min(initialSelection.anchor, view.state.doc.length))
        const head = Math.max(0, Math.min(initialSelection.head, view.state.doc.length))

        window.requestAnimationFrame(() => {
          if (!view.dom.isConnected) {
            return
          }

          view.focus()
          view.dispatch({
            selection: { anchor, head },
            scrollIntoView: true,
          })
        })
      }
    },
    [initialSelection, readOnly, resolvedVimMode]
  )

  const languageExtension = useMemo(() => {
    switch (language) {
      case 'json':
        return jsonLanguageExtension
      case 'json5':
        return json5LanguageExtension
      case 'javascript':
        return javascriptLanguageExtension
      case 'jsx':
        return jsxLanguageExtension
      case 'html':
        return htmlLanguageExtension
      case 'css':
        return cssLanguageExtension
      case 'xml':
        return xmlLanguageExtension
      default:
        return null
    }
  }, [language])

  const scaledEditorTheme = useMemo(() => createScaledEditorTheme(size, scale), [scale, size])

  const compactTheme = useMemo(() => {
    if (!compact) {
      return EditorView.theme({
        '& .cm-line': {
          padding: '0 !important',
        },
      })
    }

    return EditorView.theme({
      '& .cm-content': {
        padding: '0.44rem 0 !important',
        lineHeight: '1.25rem',
      },
      '& .cm-line': {
        padding: linePaddingOverride ?? '0 !important',
      },
    })
  }, [compact, linePaddingOverride])

  const placeholderValueExtension = useMemo(
    () => (placeholder ? placeholderExtension(placeholder) : null),
    [placeholder]
  )

  const pasteHandlerExtension = useMemo(() => {
    if (!onPasteText) {
      return null
    }

    return EditorView.domEventHandlers({
      paste(event) {
        const text = event.clipboardData?.getData('text/plain')
        if (!text) {
          return false
        }

        const selection = editorViewRef.current?.state.selection.main
        const value = editorViewRef.current?.state.doc.toString() ?? ''
        const selectionFrom = selection?.from ?? 0
        const selectionTo = selection?.to ?? 0
        const selectedText = value.slice(selectionFrom, selectionTo)

        const handled =
          onPasteTextRef.current?.({
            text,
            value,
            selectionFrom,
            selectionTo,
            selectedText,
          }) ?? false
        if (handled) {
          event.preventDefault()
          return true
        }

        return false
      },
    })
  }, [onPasteText])

  const selectionListenerExtension = useMemo(
    () =>
      EditorView.updateListener.of(update => {
        if (!update.selectionSet) {
          return
        }

        const selection = update.state.selection.main
        onSelectionChangeRef.current?.({
          anchor: selection.anchor,
          head: selection.head,
        })
      }),
    []
  )

  const resolvedExtensions = useMemo(() => {
    const nextExtensions: Extension[] = [
      selectionMatchesExtension,
      ...baseSetupExtensions,
      tabSizeExtension,
      editorTheme,
      scaledEditorTheme,
      syntaxHighlighting(editorHighlightStyle),
      selectionMatchTheme,
      selectionListenerExtension,
    ]
    const canComment = !readOnly && supportsCommentCommands(language)

    if (resolvedVimMode) {
      nextExtensions.unshift(vimExtension)
    }

    if (canComment) {
      nextExtensions.push(commentKeymapExtension)
    }

    if (compactTheme) {
      nextExtensions.push(compactTheme)
    }

    if (hideFocusOutline) {
      nextExtensions.push(hideFocusOutlineTheme)
    }

    if (placeholderValueExtension) {
      nextExtensions.push(placeholderValueExtension)
    }

    if (languageExtension) {
      nextExtensions.push(languageExtension)
    }

    if (language === 'json5') {
      nextExtensions.push(json5CommentTokensExtension)
    }

    if (readOnly) {
      nextExtensions.push(readOnlyExtension)
    }

    if (showFoldGutter) {
      nextExtensions.push(foldGutterExtension)
    }

    if (language === 'javascript' || language === 'jsx' || language === 'json' || language === 'json5') {
      nextExtensions.push(lintGutterExtension)
    }

    if (showLineNumbers) {
      nextExtensions.push(lineNumbersExtension)
    }

    if (singleLine) {
      nextExtensions.push(singleLineContentTheme, singleLineTransactionFilter)
    }

    if (pasteHandlerExtension) {
      nextExtensions.push(pasteHandlerExtension)
    }

    if (extensions) {
      nextExtensions.push(...extensions)
    }

    return nextExtensions
  }, [
    compactTheme,
    extensions,
    hideFocusOutline,
    language,
    languageExtension,
    pasteHandlerExtension,
    placeholderValueExtension,
    readOnly,
    scaledEditorTheme,
    showFoldGutter,
    showLineNumbers,
    singleLine,
    resolvedVimMode,
    selectionListenerExtension,
  ])

  return (
    <div
      data-testid={testId}
      className={twMerge(
        'flex w-full min-h-0 flex-1 overflow-visible rounded-none border border-base-content/10 bg-base-100/70 text-base-content',
        readOnly ? 'overflow-auto' : '',
        minHeightClassName,
        className
      )}
    >
      <CodeMirror
        value={initialValueRef.current}
        height="100%"
        className="h-full w-full"
        theme="dark"
        basicSetup={false}
        indentWithTab={false}
        extensions={resolvedExtensions}
        onCreateEditor={handleCreateEditor}
        onChange={handleEditorChange}
        onBlur={handleEditorBlur}
      />
    </div>
  )
})

CodeEditor.displayName = 'CodeEditor'
