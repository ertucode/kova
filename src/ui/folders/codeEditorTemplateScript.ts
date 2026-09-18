import {
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import { parser as javaScriptParser } from '@lezer/javascript'
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, hoverTooltip, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { formatScriptPackageSpecifier } from '@common/ScriptPackages'
import { POSTMAN_DYNAMIC_VARIABLE_NAMES } from '@common/PostmanDynamicVariables'
import type {
  ScriptAutocompletePackage,
  ScriptAutocompleteSharedScript,
  ScriptHoverInfo,
} from './scriptAutocompleteTypes'
import { codeEditorTabBehaviorExtension } from './codeEditorTabBehavior'
import { createScriptHoverTooltip } from './codeEditorScriptHover'
import { requestScriptAutocomplete, requestScriptHover } from './scriptAutocompleteClient'
import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import { SharedScriptCoordinator } from './sharedScriptCoordinator'

type TemplateScriptOptions = {
  phase?: ScriptAutocompletePhase
  getEnvironmentNames?: () => string[]
  getVariableNames?: () => string[]
  getSharedScripts?: () => ScriptAutocompleteSharedScript[]
  getPackages?: () => ScriptAutocompletePackage[]
  fallbackToBrowserTab?: boolean
}

type TemplateExpressionMatch = {
  from: number
  to: number
  contentFrom: number
  contentTo: number
  code: string
}

const TEMPLATE_EXPRESSION_REGEX = /\\?\{\{\$([\s\S]*?)\}\}/g
const templateScriptParser = javaScriptParser.configure({ dialect: 'ts jsx' })
const preferredTemplateGlobals = new Set(['env', 'scope', 'request', 'crypto', 'faker', 'z'])
const templateScriptHighlighter = tagHighlighter([
  { tag: [tags.keyword, tags.modifier], class: 'cm-template-script-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'cm-template-script-string' },
  { tag: [tags.number, tags.integer, tags.float], class: 'cm-template-script-number' },
  { tag: [tags.bool, tags.null], class: 'cm-template-script-atom' },
  { tag: [tags.comment], class: 'cm-template-script-comment' },
  { tag: [tags.operator], class: 'cm-template-script-operator' },
  { tag: [tags.punctuation, tags.separator], class: 'cm-template-script-punctuation' },
  { tag: [tags.paren, tags.squareBracket, tags.brace], class: 'cm-template-script-brace' },
  { tag: [tags.variableName, tags.propertyName, tags.labelName], class: 'cm-template-script-identifier' },
])

export function templateScriptExtension(options: TemplateScriptOptions): Extension {
  return [
    templateScriptTheme,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet

        constructor(view: EditorView) {
          this.decorations = buildTemplateScriptDecorations(view)
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildTemplateScriptDecorations(update.view)
          }
        }
      },
      {
        decorations: value => value.decorations,
      }
    ),
    codeEditorTabBehaviorExtension(options),
    hoverTooltip(
      async (view, position) => {
        const hover = await loadTemplateScriptHover(view, position, options)
        return hover ? createScriptHoverTooltip(hover) : null
      },
      {
        hideOnChange: true,
        hoverTime: 200,
      }
    ),
    EditorView.domEventHandlers({
      keydown(event, view) {
        updateTemplateSourceNavigationCursor(view, event)
        return false
      },
      keyup(event, view) {
        updateTemplateSourceNavigationCursor(view, event)
        return false
      },
      mousemove(event, view) {
        updateTemplateSourceNavigationCursor(view, event)
        return false
      },
      mousedown(event, view) {
        updateTemplateSourceNavigationCursor(view, event)
        if (!isTemplateSourceNavigationClick(event)) {
          return false
        }

        const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (position === null || !getTemplateScriptSourceCandidateAtPosition(view.state.doc.toString(), position)) {
          return false
        }

        event.preventDefault()
        void loadTemplateScriptHover(view, position, options).then(hover => {
          if (hover?.source) {
            void SharedScriptCoordinator.openScript(hover.source)
          }
        })
        return true
      },
      mouseleave(_event, view) {
        view.dom.classList.remove('cm-template-source-navigation')
      },
      blur(_event, view) {
        view.dom.classList.remove('cm-template-source-navigation')
      },
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) {
        return
      }

      const selection = update.state.selection.main
      if (!selection.empty) {
        return
      }

      const expression = findTemplateScriptExpressionAtPosition(update.state.doc.toString(), selection.from)
      if (!expression) {
        return
      }

      const snippetBeforeCursor = expression.code.slice(0, selection.from - expression.contentFrom)
      if (!shouldStartTemplateScriptCompletion(snippetBeforeCursor)) {
        return
      }

      if (completionStatus(update.state) !== null) {
        return
      }

      startCompletion(update.view)
    }),
  ]
}

async function loadTemplateScriptHover(view: EditorView, position: number, options: TemplateScriptOptions) {
  const expression = findTemplateScriptExpressionAtPosition(view.state.doc.toString(), position)
  if (!expression) {
    return null
  }

  try {
    const result = await requestScriptHover({
      runtimeContext:
        options.phase === undefined || options.phase === 'pre-request'
          ? { templatePhase: 'pre-request' }
          : { phase: options.phase },
      code: expression.code,
      position: position - expression.contentFrom,
      sharedScripts: options.getSharedScripts?.(),
      packages: options.getPackages?.(),
    })

    return result?.hover ? offsetTemplateScriptHover(result.hover, expression.contentFrom) : null
  } catch {
    return null
  }
}

export function isTemplateSourceNavigationClick(
  event: Pick<MouseEvent, 'altKey' | 'metaKey'>,
  platform = navigator.platform
) {
  return /^Mac/.test(platform) ? event.metaKey : event.altKey
}

function updateTemplateSourceNavigationCursor(
  view: EditorView,
  event: Pick<MouseEvent | KeyboardEvent, 'altKey' | 'metaKey'>
) {
  view.dom.classList.toggle('cm-template-source-navigation', isTemplateSourceNavigationClick(event))
}

export function offsetTemplateScriptHover(hover: ScriptHoverInfo, offset: number): ScriptHoverInfo {
  return {
    ...hover,
    from: hover.from + offset,
    to: hover.to + offset,
  }
}

export function createTemplateCompletionSource(
  options: Pick<TemplateScriptOptions, 'getEnvironmentNames' | 'getVariableNames' | 'getSharedScripts' | 'getPackages'>,
  phase: ScriptAutocompletePhase = 'pre-request'
): CompletionSource {
  return async context => {
    const variableResult = completeTemplateVariableName(context, options.getVariableNames)
    if (variableResult) {
      return variableResult
    }

    const environmentResult = completeTemplateEnvironmentName(context, options.getEnvironmentNames)
    if (environmentResult) {
      return environmentResult
    }

    const packageResult = completeTemplatePackageSpecifier(context, options.getPackages)
    if (packageResult) {
      return packageResult
    }

    return completeTemplateScriptApi(context, phase, options.getSharedScripts, options.getPackages)
  }
}

export function findTemplateScriptExpressionAtPosition(source: string, position: number): TemplateExpressionMatch | null {
  for (const expression of findTemplateScriptExpressions(source)) {
    if (position >= expression.contentFrom && position <= expression.contentTo) {
      return expression
    }
  }

  return null
}

export function findTemplateScriptExpressions(source: string): TemplateExpressionMatch[] {
  TEMPLATE_EXPRESSION_REGEX.lastIndex = 0
  const expressions: TemplateExpressionMatch[] = []

  let match: RegExpExecArray | null
  while ((match = TEMPLATE_EXPRESSION_REGEX.exec(source)) !== null) {
    if (match[0].startsWith('\\')) {
      continue
    }

    const from = match.index
    const to = from + match[0].length
    const content = getTemplateExpressionContent(match)
    expressions.push({
      from,
      to,
      contentFrom: from + content.offset,
      contentTo: to - 2,
      code: content.code,
    })
  }

  return expressions
}

function buildTemplateScriptDecorations(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  TEMPLATE_EXPRESSION_REGEX.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TEMPLATE_EXPRESSION_REGEX.exec(text)) !== null) {
    if (match[0].startsWith('\\')) {
      continue
    }

    const matchFrom = match.index
    const matchTo = matchFrom + match[0].length
    const content = getTemplateExpressionContent(match)
    const contentFrom = matchFrom + content.offset
    const contentTo = matchTo - 2

    builder.add(matchFrom, matchTo, templateExpressionDecoration)
    builder.add(matchFrom, contentFrom, templateOpeningDelimiterDecoration)
    builder.add(contentFrom, contentTo, templateContentDecoration)

    for (const token of scanTemplateScriptTokens(content.code)) {
      const tokenFrom = contentFrom + token.from
      const tokenTo = contentFrom + token.to
      if (tokenFrom >= tokenTo) {
        continue
      }

      builder.add(tokenFrom, tokenTo, Decoration.mark({ class: token.className }))
    }

    builder.add(contentTo, contentTo + 2, templateClosingDelimiterDecoration)
  }

  return builder.finish()
}

function getTemplateExpressionContent(match: RegExpExecArray) {
  const code = match[1] ?? ''
  if (code === code.trim() && POSTMAN_DYNAMIC_VARIABLE_NAMES.has(`$${code}`)) {
    return { code: `$${code}`, offset: 2 }
  }

  return { code, offset: 3 }
}

function scanTemplateScriptTokens(source: string) {
  const tokens: Array<{ from: number; to: number; className: string }> = []
  const tree = templateScriptParser.parse(source)
  const sourceCandidate = findTemplateScriptSourceCandidateRange(source, tree)

  highlightTree(tree, templateScriptHighlighter, (from, to, className) => {
    const sourceClassName = sourceCandidate?.from === from && sourceCandidate.to === to
      ? ' cm-template-script-source'
      : ''
    tokens.push({
      from,
      to,
      className: `${getTemplateTokenClassName(className, source.slice(from, to))}${sourceClassName}`,
    })
  })

  return tokens
}

export function findTemplateScriptSourceCandidateRange(
  source: string,
  tree = templateScriptParser.parse(source)
) {
  const expressionStatement = tree.topNode.firstChild
  if (expressionStatement?.name !== 'ExpressionStatement' || expressionStatement.nextSibling) {
    return null
  }

  const expression = expressionStatement.firstChild
  if (expression?.name === 'VariableName') {
    return { from: expression.from, to: expression.to }
  }

  if (expression?.name === 'CallExpression') {
    const callee = expression.firstChild
    if (callee?.name === 'VariableName') {
      return { from: callee.from, to: callee.to }
    }
  }

  return null
}

export function getTemplateScriptSourceCandidateAtPosition(source: string, position: number) {
  const expression = findTemplateScriptExpressionAtPosition(source, position)
  if (!expression) {
    return null
  }

  const candidate = findTemplateScriptSourceCandidateRange(expression.code)
  if (!candidate) {
    return null
  }

  const from = expression.contentFrom + candidate.from
  const to = expression.contentFrom + candidate.to
  return position >= from && position <= to ? { from, to } : null
}

function getTemplateTokenClassName(className: string, tokenText: string) {
  return className === 'cm-template-script-identifier' && preferredTemplateGlobals.has(tokenText)
    ? 'cm-template-script-global'
    : className
}

function completeTemplateVariableName(
  context: CompletionContext,
  getVariableNames: (() => string[]) | undefined
): CompletionResult | null {
  if (!getVariableNames) {
    return null
  }

  const expression = findTemplateScriptExpressionAtPosition(context.state.doc.toString(), context.pos)
  if (!expression) {
    return null
  }

  const before = expression.code.slice(Math.max(0, context.pos - expression.contentFrom - 240), context.pos - expression.contentFrom)
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
    const options = Array.from(new Set(getVariableNames().filter(name => name.trim() !== '')))
      .sort((left, right) => left.localeCompare(right))
      .filter(name => name.toLowerCase().includes(query.toLowerCase()))
      .map(name => buildQuotedStringCompletion({ label: name, type: 'variable', detail: 'variable' }, quote, suffix))

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

function completeTemplateEnvironmentName(
  context: CompletionContext,
  getEnvironmentNames: (() => string[]) | undefined
): CompletionResult | null {
  if (!getEnvironmentNames) {
    return null
  }

  const expression = findTemplateScriptExpressionAtPosition(context.state.doc.toString(), context.pos)
  if (!expression) {
    return null
  }

  const before = expression.code.slice(Math.max(0, context.pos - expression.contentFrom - 240), context.pos - expression.contentFrom)
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
    const options = Array.from(new Set(getEnvironmentNames().filter(name => name.trim() !== '')))
      .sort((left, right) => left.localeCompare(right))
      .filter(name => name.toLowerCase().includes(query.toLowerCase()))
      .map(name => buildQuotedStringCompletion({ label: name, type: 'constant', detail: 'environment' }, quote, suffix))

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

async function completeTemplateScriptApi(
  context: CompletionContext,
  phase: ScriptAutocompletePhase,
  getSharedScripts: (() => ScriptAutocompleteSharedScript[]) | undefined,
  getPackages: (() => ScriptAutocompletePackage[]) | undefined
): Promise<CompletionResult | null> {
  const expression = findTemplateScriptExpressionAtPosition(context.state.doc.toString(), context.pos)
  if (!expression) {
    return null
  }

  const relativePosition = context.pos - expression.contentFrom
  const snippetBeforeCursor = expression.code.slice(Math.max(0, relativePosition - 240), relativePosition)
  const identifierMatch = snippetBeforeCursor.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/)
  if (!identifierMatch && !context.explicit) {
    return null
  }

  try {
    const abortController = new AbortController()
    context.addEventListener('abort', () => abortController.abort(), { onDocChange: true })

    const result = await requestScriptAutocomplete({
      runtimeContext: phase === 'pre-request' ? { templatePhase: 'pre-request' } : { phase },
      code: expression.code,
      position: relativePosition,
      sharedScripts: getSharedScripts?.(),
      packages: getPackages?.(),
      signal: abortController.signal,
    })

    if (context.aborted || !result || result.options.length === 0) {
      return null
    }

    return {
      from: expression.contentFrom + result.from,
      to: expression.contentFrom + result.to,
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

function shouldStartTemplateScriptCompletion(textBeforeCursor: string) {
  if (
    /env\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /scope\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /request\.headers\.(?:get|has|set|delete)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /env\.(?:get|has)\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    /env\.set\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) ||
    getPackageSpecifierContext(textBeforeCursor) !== null
  ) {
    return true
  }

  return /(?:^|[^\w$])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/.test(textBeforeCursor)
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

function completeTemplatePackageSpecifier(
  context: CompletionContext,
  getPackages: (() => ScriptAutocompletePackage[]) | undefined
): CompletionResult | null {
  if (!getPackages) {
    return null
  }

  const expression = findTemplateScriptExpressionAtPosition(context.state.doc.toString(), context.pos)
  if (!expression) {
    return null
  }

  const before = expression.code.slice(Math.max(0, context.pos - expression.contentFrom - 240), context.pos - expression.contentFrom)
  const packageContext = getPackageSpecifierContext(before)
  if (!packageContext) {
    return null
  }

  const options = buildPackageStringCompletions(getPackages, packageContext.query).map(option =>
    buildQuotedStringCompletion(option, packageContext.quote, packageContext.suffix)
  )

  if (options.length === 0) {
    return null
  }

  return {
    from: context.pos - packageContext.query.length,
    to: context.pos,
    options,
    filter: false,
    validFor: /^[^'"]*$/,
  }
}

function buildPackageStringCompletions(
  getPackages: (() => ScriptAutocompletePackage[]) | undefined,
  query: string
): Completion[] {
  if (!getPackages) {
    return []
  }

  const packages = getPackages()
  const packageCounts = new Map<string, number>()
  for (const pkg of packages) {
    packageCounts.set(pkg.packageName, (packageCounts.get(pkg.packageName) ?? 0) + 1)
  }

  const entries: Array<{ label: string; detail: string; boost: number }> = []
  const seen = new Set<string>()
  const normalizedQuery = query.toLowerCase()

  for (const pkg of packages) {
    if (pkg.downloadStatus !== 'ready') {
      continue
    }

    if ((packageCounts.get(pkg.packageName) ?? 0) === 1 && !seen.has(pkg.packageName)) {
      seen.add(pkg.packageName)
      entries.push({
        label: pkg.packageName,
        detail: `package ${pkg.packageVersion}`,
        boost: 20,
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

const templateOpeningDelimiterDecoration = Decoration.mark({
  class: 'cm-template-script-delimiter cm-template-script-delimiter-open',
})

const templateClosingDelimiterDecoration = Decoration.mark({
  class: 'cm-template-script-delimiter cm-template-script-delimiter-close',
})

const templateContentDecoration = Decoration.mark({
  class: 'cm-template-script-content',
})

const templateExpressionDecoration = Decoration.mark({
  attributes: {
    'data-template-script': 'true',
  },
  class: 'cm-template-script-expression',
})

const templateScriptTheme = EditorView.baseTheme({
  '&.cm-template-source-navigation .cm-template-script-source:hover, &.cm-template-source-navigation .cm-template-script-source:hover *': {
    cursor: 'pointer !important',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in oklab, var(--color-secondary) 70%, transparent)',
    textUnderlineOffset: '0.18rem',
  },
  '.cm-template-script-expression': {
    background: 'transparent !important',
    borderRadius: '0',
    padding: '0',
    boxShadow: 'none',
  },
  '.cm-template-script-delimiter, .cm-template-script-content': {
    background: 'color-mix(in oklab, var(--color-secondary) 16%, transparent) !important',
    boxShadow: 'inset 0 1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent)',
  },
  '.cm-template-script-delimiter-open': {
    borderTopLeftRadius: '0.375rem',
    borderBottomLeftRadius: '0.375rem',
    paddingLeft: '0.12rem',
    boxShadow:
      'inset 1px 0 0 color-mix(in oklab, var(--color-secondary) 30%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent)',
  },
  '.cm-template-script-delimiter-close': {
    borderTopRightRadius: '0.375rem',
    borderBottomRightRadius: '0.375rem',
    paddingRight: '0.12rem',
    boxShadow:
      'inset -1px 0 0 color-mix(in oklab, var(--color-secondary) 30%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--color-secondary) 30%, transparent)',
  },
  '.cm-template-script-content, .cm-template-script-content *': {
    color: 'color-mix(in oklab, var(--color-base-content) 88%, var(--color-secondary) 12%) !important',
  },
  '.cm-template-script-delimiter, .cm-template-script-delimiter *': {
    color: 'var(--color-warning) !important',
    fontWeight: '700',
  },
  '.cm-template-script-keyword, .cm-template-script-keyword *': {
    color: 'var(--color-primary) !important',
  },
  '.cm-template-script-string, .cm-template-script-string *': {
    color: 'var(--color-accent) !important',
  },
  '.cm-template-script-number, .cm-template-script-number *': {
    color: 'var(--color-info) !important',
  },
  '.cm-template-script-atom, .cm-template-script-atom *': {
    color: 'var(--color-info) !important',
  },
  '.cm-template-script-global, .cm-template-script-global *': {
    color: 'var(--color-base-content) !important',
  },
  '.cm-template-script-identifier, .cm-template-script-identifier *': {
    color: 'var(--color-base-content) !important',
  },
  '.cm-template-script-comment, .cm-template-script-comment *': {
    color: 'color-mix(in oklab, var(--color-base-content) 45%, transparent) !important',
    fontStyle: 'italic',
  },
  '.cm-template-script-operator, .cm-template-script-operator *': {
    color: 'color-mix(in oklab, var(--color-base-content) 68%, transparent) !important',
  },
  '.cm-template-script-punctuation, .cm-template-script-punctuation *': {
    color: 'color-mix(in oklab, var(--color-base-content) 68%, transparent) !important',
  },
  '.cm-template-script-brace, .cm-template-script-brace *': {
    color: 'color-mix(in oklab, var(--color-base-content) 76%, transparent) !important',
  },
})

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
