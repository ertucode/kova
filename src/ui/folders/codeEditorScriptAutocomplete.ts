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
import type { SharedScriptTarget } from '@common/SharedScripts'
import type { ScriptAutocompletePackage, ScriptAutocompleteSharedScript } from './scriptAutocompleteTypes'

type ScriptAutocompleteOptions = {
  includeResponse: boolean
  phase?: ScriptAutocompletePhase
  targets?: SharedScriptTarget[]
  getEnvironmentNames?: () => string[]
  getVariableNames?: () => string[]
  getSharedScripts?: () => ScriptAutocompleteSharedScript[]
  getPackages?: () => ScriptAutocompletePackage[]
  fallbackToBrowserTab?: boolean
}

export function scriptAutocompleteExtension(options: ScriptAutocompleteOptions): Extension {
  const phase: ScriptAutocompletePhase = options.phase ?? (options.includeResponse ? 'post-request' : 'pre-request')
  const runtimeContext = options.targets ? { targets: options.targets } : { phase }

  return [
    codeEditorTabBehaviorExtension(options),
    autocompletion({
      activateOnTyping: true,
      override: [
        context => completeVariableName(context, options.getVariableNames),
        context => completeEnvironmentName(context, options.getEnvironmentNames),
        context => completeScriptApi(context, runtimeContext, options.getSharedScripts, options.getPackages),
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
    const suffix = getFirstArgumentCompletionSuffix(before)
    const options = buildVariableStringCompletions(getVariableNames)
      .filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      .map(option => buildQuotedStringCompletion(option, quote, suffix))

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
    const suffix = ')'
    const options = buildEnvironmentStringCompletions(getEnvironmentNames)
      .filter(option => option.label.toLowerCase().includes(query.toLowerCase()))
      .map(option => buildQuotedStringCompletion(option, quote, suffix))

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
  runtimeContext: { phase: ScriptAutocompletePhase } | { targets: SharedScriptTarget[] },
  getSharedScripts: (() => ScriptAutocompleteSharedScript[]) | undefined,
  getPackages: (() => ScriptAutocompletePackage[]) | undefined
): Promise<CompletionResult | null> {
  const identifierMatch = context.matchBefore(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/)
  if (!identifierMatch && !context.explicit) {
    return null
  }

  try {
    const abortController = new AbortController()
    context.addEventListener('abort', () => abortController.abort(), { onDocChange: true })

    const result = await requestScriptAutocomplete({
      runtimeContext,
      code: context.state.doc.toString(),
      position: context.pos,
      sharedScripts: getSharedScripts?.(),
      packages: getPackages?.(),
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

function buildQuotedStringCompletion(option: Completion, quote: string, suffix = ''): Completion {
  return {
    ...option,
    apply(view, completion, from, to) {
      let replacementTo = to
      const trailingText = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + quote.length + suffix.length))

      if (trailingText.startsWith(`${quote}${suffix}`)) {
        replacementTo = to + quote.length + suffix.length
      } else if (trailingText.startsWith(quote)) {
        replacementTo = to + quote.length
      }

      const replacement = `${completion.label}${quote}${suffix}`

      view.dispatch({
        changes: { from, to: replacementTo, insert: replacement },
        selection: { anchor: from + replacement.length },
      })
    },
  }
}

function getFirstArgumentCompletionSuffix(sourceBeforeCursor: string) {
  if (/env\.(?:get|has)\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ')'
  }

  if (/env\.set\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ', '
  }

  if (/scope\.(?:get|has)\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ')'
  }

  if (/scope\.set\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ', '
  }

  if (/request\.headers\.(?:get|has|delete)\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ')'
  }

  if (/request\.headers\.set\(\s*(['"])[^'"]*$/.test(sourceBeforeCursor)) {
    return ', '
  }

  return ''
}
