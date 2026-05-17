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
import { formatScriptPackageSpecifier } from '@common/ScriptPackages'
import { codeEditorTabBehaviorExtension } from './codeEditorTabBehavior'
import { requestScriptAutocomplete } from './scriptAutocompleteClient'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import type { SharedScriptTarget } from '@common/SharedScripts'
import type { ScriptAutocompleteOption, ScriptAutocompletePackage, ScriptAutocompleteSharedScript } from './scriptAutocompleteTypes'

type ScriptAutocompleteOptions = {
  includeResponse: boolean
  phase?: ScriptAutocompletePhase
  targets?: SharedScriptTarget[]
  getEnvironmentNames?: () => string[]
  getVariableNames?: () => string[]
  getRequestPaths?: () => string[][]
  getSharedScripts?: () => ScriptAutocompleteSharedScript[]
  getPackages?: () => ScriptAutocompletePackage[]
  fallbackToBrowserTab?: boolean
}

export function scriptAutocompleteExtension(options: ScriptAutocompleteOptions): Extension {
  const phase: ScriptAutocompletePhase = options.phase ?? (options.includeResponse ? 'post-request' : 'pre-request')
  const runtimeContext = options.targets ? { targets: options.targets } : { phase }
  const supportsRequestPathAutocomplete = options.targets ? options.targets.includes('post-request') : phase === 'post-request'

  return [
    codeEditorTabBehaviorExtension(options),
    autocompletion({
      activateOnTyping: true,
      override: [
        context => completeVariableName(context, options.getVariableNames),
        context => completeEnvironmentName(context, options.getEnvironmentNames),
        context => completePackageSpecifier(context, options.getPackages),
        context => completeScriptApi(
          context,
          runtimeContext,
          supportsRequestPathAutocomplete ? options.getRequestPaths : undefined,
          options.getSharedScripts,
          options.getPackages
        ),
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
      if (!shouldStartCompletion(textBeforeCursor, supportsRequestPathAutocomplete)) {
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

function completePackageSpecifier(
  context: CompletionContext,
  getPackages: (() => ScriptAutocompletePackage[]) | undefined
): CompletionResult | null {
  if (!getPackages) {
    return null
  }

  const before = context.state.doc.sliceString(Math.max(0, context.pos - 240), context.pos)
  const packageContext = getPackageSpecifierContext(before)
  if (!packageContext) {
    return null
  }

  const options = buildPackageStringCompletions(getPackages, packageContext.query)
    .map(option => buildQuotedStringCompletion(option, packageContext.quote, packageContext.suffix))

  if (options.length === 0) {
    return null
  }

  return {
    from: context.pos - packageContext.query.length,
    to: context.pos,
    options,
    validFor: /^[^'"]*$/,
  }
}

async function completeScriptApi(
  context: CompletionContext,
  runtimeContext: { phase: ScriptAutocompletePhase } | { targets: SharedScriptTarget[] },
  getRequestPaths: (() => string[][]) | undefined,
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
      requestPaths: getRequestPaths?.(),
      sharedScripts: getSharedScripts?.(),
      packages: getPackages?.(),
      signal: abortController.signal,
    })

    if (context.aborted || !result || result.options.length === 0) {
      return null
    }

    const requestPathContext = getRequestPathContext(context.state.doc.toString(), context.pos)
    const filteredOptions = requestPathContext
      ? filterRequestPathOptions(result.options, getRequestPaths?.() ?? [], requestPathContext)
      : result.options

    if (filteredOptions.length === 0) {
      return null
    }

    return {
      from: result.from,
      to: result.to,
      options: filteredOptions.map(option => ({
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

function getRequestPathContext(source: string, position: number) {
  const sourceBeforeCursor = source.slice(Math.max(0, position - 400), position)
  const invocationMatch = Array.from(sourceBeforeCursor.matchAll(/(?:navigateAndCallRequest|callRequest)\(\s*\[/g)).at(-1)
  if (!invocationMatch || invocationMatch.index === undefined) {
    return null
  }

  const arraySource = sourceBeforeCursor.slice(invocationMatch.index + invocationMatch[0].length)
  if (arraySource.includes(']')) {
    return null
  }

  return parseRequestPathSegments(arraySource)
}

function parseRequestPathSegments(source: string): { prefixSegments: string[]; query: string } | null {
  let index = 0
  const prefixSegments: string[] = []

  while (index < source.length) {
    index = skipWhitespace(source, index)
    if (index >= source.length) {
      return null
    }

    const quote = source[index]
    if (quote !== '"' && quote !== "'") {
      return null
    }

    index += 1
    let value = ''
    let closed = false
    while (index < source.length) {
      const character = source[index]
      if (character === quote) {
        closed = true
        index += 1
        index = skipWhitespace(source, index)
        if (index >= source.length) {
          return null
        }
        if (source[index] !== ',') {
          return null
        }
        prefixSegments.push(value)
        index += 1
        break
      }

      value += character
      index += 1
    }

    if (!closed) {
      return { prefixSegments, query: value }
    }
  }

  return null
}

function filterRequestPathOptions(
  options: ScriptAutocompleteOption[],
  requestPaths: string[][],
  context: { prefixSegments: string[]; query: string }
) {
  const allowedSegments = new Set<string>()

  for (const path of requestPaths) {
    if (path.length <= context.prefixSegments.length) {
      continue
    }

    if (!context.prefixSegments.every((segment, index) => path[index] === segment)) {
      continue
    }

    allowedSegments.add(path[context.prefixSegments.length] ?? '')
  }

  if (allowedSegments.size === 0) {
    return options
  }

  const normalizedQuery = context.query.toLowerCase()
  return options
    .filter((option: ScriptAutocompleteOption) => allowedSegments.has(option.label))
    .sort((left: ScriptAutocompleteOption, right: ScriptAutocompleteOption) => {
      const leftStartsWithQuery = left.label.toLowerCase().startsWith(normalizedQuery)
      const rightStartsWithQuery = right.label.toLowerCase().startsWith(normalizedQuery)
      if (leftStartsWithQuery !== rightStartsWithQuery) {
        return leftStartsWithQuery ? -1 : 1
      }

      return left.label.localeCompare(right.label)
    })
}

function skipWhitespace(source: string, index: number) {
  while (index < source.length && /\s/.test(source[index] ?? '')) {
    index += 1
  }

  return index
}

function shouldStartCompletion(textBeforeCursor: string, supportsRequestPathAutocomplete: boolean) {
  if (
    /env\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /scope\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /request\.headers\.(?:get|has|set|delete)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    (supportsRequestPathAutocomplete && /(?:navigateAndCallRequest|callRequest)\(\s*\[.*$/.test(textBeforeCursor)) ||
    /env\.(?:get|has)\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /env\.set\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    getPackageSpecifierContext(textBeforeCursor) !== null
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

function buildPackageStringCompletions(
  getPackages: (() => ScriptAutocompletePackage[]) | undefined,
  query: string
): Completion[] {
  if (!getPackages) {
    return []
  }

  const normalizedQuery = query.trim().toLowerCase()
  const seen = new Set<string>()
  const entries: Array<{ label: string; detail: string; boost: number }> = []
  const packageCounts = new Map<string, number>()

  for (const pkg of getPackages()) {
    packageCounts.set(pkg.packageName, (packageCounts.get(pkg.packageName) ?? 0) + 1)
  }

  for (const pkg of getPackages()) {
    if (packageCounts.get(pkg.packageName) === 1 && !seen.has(pkg.packageName)) {
      seen.add(pkg.packageName)
      entries.push({
        label: pkg.packageName,
        detail: 'package',
        boost: 30,
      })
    }

    const versionedSpecifier = formatScriptPackageSpecifier(pkg.packageName, pkg.packageVersion)
    if (!seen.has(versionedSpecifier)) {
      seen.add(versionedSpecifier)
      entries.push({
        label: versionedSpecifier,
        detail: `package ${pkg.packageVersion}`,
        boost: 10,
      })
    }
  }

  return entries
    .filter(entry => normalizedQuery === '' || entry.label.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      const leftVersionless = !left.label.includes('@', 1)
      const rightVersionless = !right.label.includes('@', 1)
      if (leftVersionless !== rightVersionless) {
        return leftVersionless ? -1 : 1
      }

      return left.label.localeCompare(right.label)
    })
    .map(entry => ({
      label: entry.label,
      type: 'module',
      detail: entry.detail,
      boost: entry.boost,
    }))
}

function getPackageSpecifierContext(sourceBeforeCursor: string) {
  const patterns = [
    { pattern: /loadPackage\(\s*(['"])([^'"]*)$/, suffix: ')' },
    { pattern: /import\(\s*(['"])([^'"]*)$/, suffix: ')' },
    { pattern: /(?:^|[\s;])import\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?(['"])([^'"]*)$/, suffix: '' },
    { pattern: /(?:^|[\s;])export\s+[^'"\n]+?\s+from\s+(['"])([^'"]*)$/, suffix: '' },
  ]

  for (const { pattern, suffix } of patterns) {
    const match = sourceBeforeCursor.match(pattern)
    if (!match) {
      continue
    }

    return {
      quote: match[1] ?? '"',
      query: match[2] ?? '',
      suffix,
    }
  }

  return null
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
