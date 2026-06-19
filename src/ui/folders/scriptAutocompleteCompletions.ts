import ts from 'typescript'
import type { ScriptAutocompleteOption } from './scriptAutocompleteTypes'

const eagerlyHydratedOptionCount = 10

export type RankedScriptAutocompleteEntry = {
  entry: ts.CompletionEntry
  boost: number
}

const blockedKeywordCompletions = new Set([
  'abstract',
  'any',
  'as',
  'asserts',
  'declare',
  'enum',
  'implements',
  'infer',
  'interface',
  'is',
  'keyof',
  'module',
  'namespace',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'satisfies',
  'type',
])

const preferredSandboxGlobals = new Set([
  'env',
  'scope',
  'cache',
  'request',
  'response',
  'callRequest',
  'console',
  'crypto',
  'prompt',
  'toast',
  'z',
])
const preferredBuiltinGlobals = new Set(['Date', 'Math', 'JSON', 'Promise', 'Object', 'Array', 'Map', 'Set', 'String', 'Number'])

export function toScriptAutocompleteResult(
  service: ts.LanguageService,
  fileName: string,
  position: number,
  code: string,
  completions: ts.WithMetadata<ts.CompletionInfo>
) {
  const replacementFrom = completions.optionalReplacementSpan ? completions.optionalReplacementSpan.start : position
  const query = code.slice(replacementFrom, position)
  const rankedEntries = rankScriptAutocompleteEntries(completions.entries, query)
  const options = hydrateScriptAutocompleteOptions(service, fileName, position, rankedEntries)

  return {
    from: replacementFrom,
    to: completions.optionalReplacementSpan ? completions.optionalReplacementSpan.start + completions.optionalReplacementSpan.length : position,
    options,
  }
}

export function rankScriptAutocompleteEntries(entries: readonly ts.CompletionEntry[], query: string) {
  const rankedEntries: RankedScriptAutocompleteEntry[] = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry || !isAllowedEntry(entry)) {
      continue
    }

    rankedEntries.push({
      entry,
      boost: toBoost(entry, index, query),
    })
  }

  rankedEntries.sort(compareRankedEntries)
  if (rankedEntries.length > 200) {
    rankedEntries.length = 200
  }

  return rankedEntries
}

export function hydrateScriptAutocompleteOptions(
  service: ts.LanguageService,
  fileName: string,
  position: number,
  rankedEntries: readonly RankedScriptAutocompleteEntry[]
) {
  const options: ScriptAutocompleteOption[] = []

  for (let index = 0; index < rankedEntries.length; index += 1) {
    const rankedEntry = rankedEntries[index]
    if (!rankedEntry) {
      continue
    }

    options.push(
      index < eagerlyHydratedOptionCount
        ? toHydratedOption(service, fileName, position, rankedEntry.entry, rankedEntry.boost)
        : toCheapOption(rankedEntry.entry, rankedEntry.boost)
    )
  }

  return options
}

function isAllowedEntry(entry: ts.CompletionEntry) {
  if (entry.kind === ts.ScriptElementKind.keyword && blockedKeywordCompletions.has(entry.name)) {
    return false
  }

  return true
}

function toHydratedOption(
  service: ts.LanguageService,
  fileName: string,
  position: number,
  entry: ts.CompletionEntry,
  boost: number
): ScriptAutocompleteOption {
  const details = service.getCompletionEntryDetails(fileName, position, entry.name, {}, entry.source, {}, entry.data)
  const display = ts.displayPartsToString(details?.displayParts ?? [])
  const documentation = ts.displayPartsToString(details?.documentation ?? [])

  return {
    label: entry.name,
    type: mapCompletionKind(entry.kind),
    detail: display || entry.kind,
    info: documentation || undefined,
    applyText: entry.insertText && !entry.isSnippet ? entry.insertText : undefined,
    boost,
  }
}

function toCheapOption(entry: ts.CompletionEntry, boost: number): ScriptAutocompleteOption {
  return {
    label: entry.name,
    type: mapCompletionKind(entry.kind),
    detail: entry.kind,
    applyText: entry.insertText && !entry.isSnippet ? entry.insertText : undefined,
    boost,
  }
}

function toBoost(entry: ts.CompletionEntry, index: number, query: string) {
  const baseBoost = Math.max(-40, 40 - index)
  return clampBoost(baseBoost + scoreEntry(entry, query))
}

function compareRankedEntries(left: RankedScriptAutocompleteEntry, right: RankedScriptAutocompleteEntry) {
  if (left.boost !== right.boost) {
    return right.boost - left.boost
  }

  const sortTextComparison = left.entry.sortText.localeCompare(right.entry.sortText)
  if (sortTextComparison !== 0) {
    return sortTextComparison
  }

  return left.entry.name.localeCompare(right.entry.name)
}

function scoreEntry(entry: ts.CompletionEntry, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedName = entry.name.toLowerCase()
  let score = 0

  if (isLocalValueEntry(entry)) {
    score += 35
  }

  if (preferredSandboxGlobals.has(entry.name)) {
    score += normalizedQuery === '' ? 70 : 40
  } else if (preferredBuiltinGlobals.has(entry.name)) {
    score += normalizedQuery === '' ? 20 : 10
  } else if (normalizedQuery === '' && isGenericGlobalEntry(entry)) {
    score -= 15
  }

  if (normalizedQuery !== '') {
    if (normalizedName === normalizedQuery) {
      score += 80
    } else if (normalizedName.startsWith(normalizedQuery)) {
      score += 45
    } else if (normalizedName.includes(normalizedQuery)) {
      score += 10
    } else {
      score -= 25
    }
  }

  return score
}

function isLocalValueEntry(entry: ts.CompletionEntry) {
  return (
    entry.kind === ts.ScriptElementKind.localVariableElement ||
    entry.kind === ts.ScriptElementKind.variableElement ||
    entry.kind === ts.ScriptElementKind.parameterElement ||
    entry.kind === ts.ScriptElementKind.localFunctionElement
  )
}

function isGenericGlobalEntry(entry: ts.CompletionEntry) {
  return entry.source === undefined && !isLocalValueEntry(entry)
}

function clampBoost(value: number) {
  return Math.max(-99, Math.min(99, value))
}

function mapCompletionKind(kind: ts.ScriptElementKind): ScriptAutocompleteOption['type'] {
  switch (kind) {
    case ts.ScriptElementKind.keyword:
      return 'keyword'
    case ts.ScriptElementKind.primitiveType:
    case ts.ScriptElementKind.localClassElement:
    case ts.ScriptElementKind.typeElement:
    case ts.ScriptElementKind.classElement:
      return 'type'
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.constructSignatureElement:
      return 'function'
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.localVariableElement:
    case ts.ScriptElementKind.parameterElement:
      return 'variable'
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.memberAccessorVariableElement:
      return 'property'
    case ts.ScriptElementKind.enumElement:
      return 'constant'
    case ts.ScriptElementKind.interfaceElement:
      return 'interface'
    default:
      return 'text'
  }
}
