import {
  autocompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { codeEditorTabBehaviorExtension } from './codeEditorTabBehavior'
import { requestScriptAutocomplete } from './scriptAutocompleteClient'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'

type ScriptAutocompleteOptions = {
  includeResponse: boolean
  getEnvironmentNames?: () => string[]
  getVariableNames?: () => string[]
  fallbackToBrowserTab?: boolean
}

export function scriptAutocompleteExtension(options: ScriptAutocompleteOptions): Extension {
  const phase: ScriptAutocompletePhase = options.includeResponse ? 'post-request' : 'pre-request'

  return [
    codeEditorTabBehaviorExtension(options),
    autocompletion({
      activateOnTyping: true,
      override: [
        context => completeVariableName(context, options.getVariableNames),
        context => completeEnvironmentName(context, options.getEnvironmentNames),
        context => completeScriptApi(context, phase),
      ],
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) {
        return
      }

      const selection = update.state.selection.main
      if (!selection.empty) {
        return
      }

      const textBeforeCursor = update.state.doc.sliceString(Math.max(0, selection.from - 240), selection.from)
      if (!shouldStartCompletion(textBeforeCursor)) {
        return
      }

      if (completionStatus(update.state) !== null) {
        return
      }

      startCompletion(update.view)
    }),
  ]
}

function completeVariableName(
  context: CompletionContext,
  getVariableNames: (() => string[]) | undefined
): CompletionResult | null {
  if (!getVariableNames) {
    return null
  }

  const before = context.state.doc.sliceString(Math.max(0, context.pos - 240), context.pos)
  const patterns = [
    /env\.(?:get|has|set)\(\s*(['"])([^'"]*)$/,
    /scope\.(?:get|has|set)\(\s*(['"])([^'"]*)$/,
    /request\.headers\.(?:get|has|set|delete)\(\s*(['"])([^'"]*)$/,
  ]

  for (const pattern of patterns) {
    const match = before.match(pattern)
    if (!match) {
      continue
    }

    const quote = match[1] ?? '"'
    const query = match[2] ?? ''
    const options = buildVariableStringCompletions(getVariableNames)
      .filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      .map(option => buildQuotedStringCompletion(option, quote))

    if (options.length === 0) {
      return null
    }

    return {
      from: context.pos - query.length,
      to: context.pos,
      options,
      filter: false,
      validFor: /^[^'"]*$/,
    }
  }

  return null
}

function completeEnvironmentName(
  context: CompletionContext,
  getEnvironmentNames: (() => string[]) | undefined
): CompletionResult | null {
  if (!getEnvironmentNames) {
    return null
  }

  const before = context.state.doc.sliceString(Math.max(0, context.pos - 240), context.pos)
  const patterns = [
    /env\.(?:get|has)\(\s*(['"])[^'"]*['"]\s*,\s*(['"])([^'"]*)$/,
    /env\.set\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*['"]\s*,\s*(['"])([^'"]*)$/,
  ]

  for (const pattern of patterns) {
    const match = before.match(pattern)
    if (!match) {
      continue
    }

    const quote = match[match.length - 2] ?? '"'
    const query = match[match.length - 1] ?? ''
    const options = buildEnvironmentStringCompletions(getEnvironmentNames)
      .filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      .map(option => buildQuotedStringCompletion(option, quote))

    if (options.length === 0) {
      return null
    }

    return {
      from: context.pos - query.length,
      to: context.pos,
      options,
      filter: false,
      validFor: /^[^'"]*$/,
    }
  }

  return null
}

async function completeScriptApi(
  context: CompletionContext,
  phase: ScriptAutocompletePhase
): Promise<CompletionResult | null> {
  const identifierMatch = context.matchBefore(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/)
  if (!identifierMatch && !context.explicit) {
    return null
  }

  try {
    const abortController = new AbortController()
    context.addEventListener('abort', () => abortController.abort(), { onDocChange: true })

    const result = await requestScriptAutocomplete({
      phase,
      code: context.state.doc.toString(),
      position: context.pos,
      signal: abortController.signal,
    })

    if (context.aborted || !result || result.options.length === 0) {
      return null
    }

    return {
      from: result.from,
      to: result.to,
      options: result.options.map(option => ({
        label: option.label,
        type: option.type,
        detail: option.detail,
        info: option.info,
        boost: option.boost,
        apply: option.applyText,
      })),
      validFor: /^[A-Za-z_$\d]*$/,
    }
  } catch {
    return null
  }
}

function shouldStartCompletion(textBeforeCursor: string) {
  if (
    /env\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /scope\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /request\.headers\.(?:get|has|set|delete)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /env\.(?:get|has)\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /env\.set\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor)
  ) {
    return true
  }

  return /(?:^|[^\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/.test(textBeforeCursor)
}

function buildVariableStringCompletions(getVariableNames: (() => string[]) | undefined): Completion[] {
  if (!getVariableNames) {
    return []
  }

  return Array.from(new Set(getVariableNames().filter(name => name.trim() !== '')))
    .sort((left, right) => left.localeCompare(right))
    .map(name => ({
      label: name,
      type: 'variable',
      detail: 'variable',
    }))
}

function buildEnvironmentStringCompletions(getEnvironmentNames: (() => string[]) | undefined): Completion[] {
  if (!getEnvironmentNames) {
    return []
  }

  return Array.from(new Set(getEnvironmentNames().filter(name => name.trim() !== '')))
    .sort((left, right) => left.localeCompare(right))
    .map(name => ({
      label: name,
      type: 'constant',
      detail: 'environment',
    }))
}

function buildQuotedStringCompletion(option: Completion, quote: string): Completion {
  return {
    ...option,
    apply(view, completion, from, to) {
      const nextCharacter = view.state.doc.sliceString(to, to + 1)
      const replacementTo = nextCharacter === quote ? to + 1 : to
      const replacement = `${completion.label}${quote}`

      view.dispatch({
        changes: { from, to: replacementTo, insert: replacement },
        selection: { anchor: from + replacement.length },
      })
    },
  }
}
