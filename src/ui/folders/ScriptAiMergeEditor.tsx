import { javascript } from '@codemirror/lang-javascript'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { useEffect, useMemo, useRef } from 'react'
import type { CodeEditorLanguage } from './CodeEditor'

const readOnlyExtension = EditorState.readOnly.of(true)

const mergeTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '0.75rem',
    backgroundColor: 'transparent',
    color: 'var(--color-base-content)',
  },
  '.cm-editor': {
    height: '100%',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily:
      'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
    lineHeight: '1.25rem',
  },
  '.cm-content': {
    padding: '0.6rem 0.6rem 0.6rem 0.45rem',
    minHeight: '100%',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    color: 'color-mix(in oklab, var(--color-base-content) 42%, transparent)',
  },
  '.cm-mergeView': {
    height: '100%',
  },
  '.cm-mergeViewEditors': {
    height: '100%',
  },
  '.cm-merge-revert': {
    display: 'none',
  },
  '.cm-changeLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-primary) 11%, transparent)',
  },
  '.cm-deletedLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-error) 11%, transparent)',
  },
  '.cm-insertedLine': {
    backgroundColor: 'color-mix(in oklab, var(--color-success) 11%, transparent)',
  },
  '.cm-changedText': {
    backgroundColor: 'color-mix(in oklab, var(--color-warning) 22%, transparent)',
  },
  '.cm-deletedText': {
    backgroundColor: 'color-mix(in oklab, var(--color-error) 18%, transparent)',
  },
  '.cm-insertedText': {
    backgroundColor: 'color-mix(in oklab, var(--color-success) 18%, transparent)',
  },
})

export function ScriptAiMergeEditor({
  originalValue,
  modifiedValue,
  language,
  onModifiedChange,
  readOnlyModified = false,
}: {
  originalValue: string
  modifiedValue: string
  language: CodeEditorLanguage
  onModifiedChange: (value: string) => void
  readOnlyModified?: boolean
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mergeViewRef = useRef<MergeView | null>(null)
  const modifiedValueRef = useRef(modifiedValue)
  const onModifiedChangeRef = useRef(onModifiedChange)

  modifiedValueRef.current = modifiedValue
  onModifiedChangeRef.current = onModifiedChange

  const languageExtension = useMemo(() => getLanguageExtension(language), [language])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) {
      return
    }

    const mergeView = new MergeView({
      parent,
      a: {
        doc: originalValue,
        extensions: [mergeTheme, lineNumbers(), languageExtension, readOnlyExtension],
      },
      b: {
        doc: modifiedValueRef.current,
        extensions: [
          mergeTheme,
          lineNumbers(),
          languageExtension,
          ...(readOnlyModified ? [readOnlyExtension] : []),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) {
              return
            }

            const nextValue = update.state.doc.toString()
            modifiedValueRef.current = nextValue
            onModifiedChangeRef.current(nextValue)
          }),
        ],
      },
      gutter: true,
      highlightChanges: true,
    })

    mergeViewRef.current = mergeView

    return () => {
      mergeView.destroy()
      mergeViewRef.current = null
    }
  }, [languageExtension, readOnlyModified])

  useEffect(() => {
    const view = mergeViewRef.current?.a
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (currentValue === originalValue) {
      return
    }

    view.dispatch({ changes: { from: 0, to: currentValue.length, insert: originalValue } })
  }, [originalValue])

  useEffect(() => {
    const view = mergeViewRef.current?.b
    if (!view) {
      return
    }

    const currentValue = view.state.doc.toString()
    if (currentValue === modifiedValue) {
      return
    }

    view.dispatch({ changes: { from: 0, to: currentValue.length, insert: modifiedValue } })
  }, [modifiedValue])

  return <div ref={containerRef} className="h-full min-h-0 overflow-auto border border-base-content/10 bg-base-100/70" />
}

function getLanguageExtension(language: CodeEditorLanguage): Extension {
  switch (language) {
    case 'jsx':
      return javascript({ jsx: true, typescript: true })
    case 'javascript':
      return javascript({ typescript: true })
    default:
      return []
  }
}
