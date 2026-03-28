import { createElement, useCallback, useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { highlightSelectionMatches } from '@codemirror/search'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, foldGutter, syntaxHighlighting } from '@codemirror/language'
import { forEachDiagnostic, lintGutter } from '@codemirror/lint'
import { json } from '@codemirror/lang-json'
import { json5 as json5Language } from 'codemirror-json5'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import { EditorView, lineNumbers, placeholder as placeholderExtension } from '@codemirror/view'
import CodeMirror, { basicSetup as codeMirrorBasicSetup } from '@uiw/react-codemirror'
import { tags } from '@lezer/highlight'
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { twMerge } from 'tailwind-merge'
import { Vim, getCM, vim } from '@replit/codemirror-vim'

export type CodeEditorLanguage = 'plain' | 'json' | 'json5' | 'javascript' | 'jsx' | 'html' | 'css' | 'xml'

export type CodeEditorHandle = {
  focusLine: (line: number, column?: number | null) => void
}

const selectionMatchesExtension = highlightSelectionMatches({ highlightWordAroundCursor: true })
const baseSetupExtensions = codeMirrorBasicSetup({
  lineNumbers: false,
  foldGutter: false,
  dropCursor: false,
  allowMultipleSelections: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
  searchKeymap: false,
})
const selectionMatchTheme = EditorView.theme({
  '& .cm-selectionMatch-main': {
    backgroundColor: 'transparent !important',
  },
})
const smallSizeTheme = EditorView.theme({
  '&': {
    fontSize: '0.78rem !important',
  },
  '.cm-scroller': {
    fontSize: '0.78rem !important',
  },
  '.cm-content': {
    fontSize: '0.78rem !important',
    lineHeight: '1.35rem !important',
  },
  '.cm-line': {
    fontSize: '0.78rem !important',
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
const foldGutterExtension = foldGutter({ markerDOM: open => createFoldMarker(open) })
const lintGutterExtension = lintGutter()
const lineNumbersExtension = lineNumbers()
const vimExtension = vim()
const jsonLanguageExtension = json()
const json5LanguageExtension = json5Language()
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
  '.cm-lintGutter': {
    width: '1.05rem',
  },
  '.cm-lintGutter .cm-gutterElement': {
    padding: '0',
    width: '1.05rem',
    justifyContent: 'center',
  },
  '.cm-lineNumbers .cm-gutterElement': {
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
    caretColor: 'currentColor',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-base-content)',
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
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in oklab, currentColor 18%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 28%, transparent)',
  },
})

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

installDiagnosticVimMappings()

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

export function CodeEditor({
  ref,
  value,
  language,
  placeholder,
  minHeightClassName,
  className,
  extensions,
  singleLine,
  compact,
  size = 'normal',
  hideFocusOutline,
  readOnly,
  showFoldGutter,
  showLineNumbers,
  onPasteText,
  onChange,
  onBlur,
  linePaddingOverride,
  vimMode = true,
  refreshKey,
}: {
  ref?: Ref<CodeEditorHandle>
  value: string
  language: CodeEditorLanguage
  placeholder?: string
  minHeightClassName?: string
  className?: string
  extensions?: Extension[]
  singleLine?: boolean
  compact?: boolean
  size?: 'normal' | 'small'
  hideFocusOutline?: boolean
  readOnly?: boolean
  showFoldGutter?: boolean
  showLineNumbers?: boolean
  onPasteText?: (text: string) => boolean
  onChange: (value: string, params: { caretPos: number; previousValue: string; previousCaretPos: number }) => void
  onBlur?: () => void
  linePaddingOverride?: string
  vimMode?: boolean
  refreshKey?: string
}) {
  const editorViewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onPasteTextRef = useRef(onPasteText)
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

      const cm = vimMode ? getCM(view) : null
      if (cm && !readOnly) {
        Vim.handleKey(cm, 'i', 'user')
      }
    },
    [readOnly, vimMode]
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

  const compactTheme = useMemo(() => {
    if (!compact) {
      return null
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

        const handled = onPasteTextRef.current?.(text) ?? false
        if (handled) {
          event.preventDefault()
          return true
        }

        return false
      },
    })
  }, [onPasteText])

  const resolvedExtensions = useMemo(() => {
    const nextExtensions: Extension[] = [
      selectionMatchesExtension,
      ...baseSetupExtensions,
      editorTheme,
      syntaxHighlighting(editorHighlightStyle),
      selectionMatchTheme,
    ]

    if (vimMode) {
      nextExtensions.unshift(vimExtension)
    }

    if (size === 'small') {
      nextExtensions.push(smallSizeTheme)
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

    if (readOnly) {
      nextExtensions.push(readOnlyExtension)
    }

    if (showFoldGutter) {
      nextExtensions.push(foldGutterExtension)
    }

    if (language === 'javascript' || language === 'jsx') {
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
    languageExtension,
    pasteHandlerExtension,
    placeholderValueExtension,
    readOnly,
    showFoldGutter,
    showLineNumbers,
    singleLine,
    size,
    vimMode,
  ])

  return (
    <div
      className={twMerge(
        'flex w-full min-h-0 flex-1 overflow-visible rounded-none border border-base-content/10 bg-base-100/70 text-base-content',
        readOnly ? 'overflow-auto' : '',
        minHeightClassName,
        className
      )}
    >
      <CodeMirror
        value={value}
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
}
