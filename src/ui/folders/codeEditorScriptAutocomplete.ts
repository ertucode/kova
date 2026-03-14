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

type ScriptApiCompletionNode = {
  label: string
  type: Completion['type']
  detail?: string
  apply?: string
  children?: ScriptApiCompletionNode[]
}

const sharedNodes: ScriptApiCompletionNode[] = [
  {
    label: 'env',
    type: 'namespace',
    detail: 'effective environment API',
    children: [
      { label: 'get', type: 'function', detail: 'env.get(name, environmentName?)', apply: 'get()' },
      { label: 'set', type: 'function', detail: 'env.set(name, value, environmentName?)', apply: 'set()' },
      { label: 'has', type: 'function', detail: 'env.has(name, environmentName?)', apply: 'has()' },
    ],
  },
  {
    label: 'scope',
    type: 'namespace',
    detail: 'request-scoped variables',
    children: [
      { label: 'get', type: 'function', detail: 'scope.get(name)', apply: 'get()' },
      { label: 'set', type: 'function', detail: 'scope.set(name, value)', apply: 'set()' },
      { label: 'has', type: 'function', detail: 'scope.has(name)', apply: 'has()' },
    ],
  },
  {
    label: 'request',
    type: 'namespace',
    detail: 'mutable request object',
    children: [
      { label: 'method', type: 'property', detail: 'request.method' },
      { label: 'url', type: 'property', detail: 'request.url' },
      { label: 'body', type: 'property', detail: 'request.body' },
      { label: 'bodyType', type: 'property', detail: 'request.bodyType' },
      { label: 'rawType', type: 'property', detail: 'request.rawType' },
      {
        label: 'headers',
        type: 'property',
        detail: 'request.headers helper',
        children: [
          { label: 'get', type: 'function', detail: 'request.headers.get(name)', apply: 'get()' },
          { label: 'set', type: 'function', detail: 'request.headers.set(name, value)', apply: 'set()' },
          { label: 'delete', type: 'function', detail: 'request.headers.delete(name)', apply: 'delete()' },
          { label: 'has', type: 'function', detail: 'request.headers.has(name)', apply: 'has()' },
          { label: 'entries', type: 'function', detail: 'request.headers.entries()', apply: 'entries()' },
          { label: 'toObject', type: 'function', detail: 'request.headers.toObject()', apply: 'toObject()' },
        ],
      },
    ],
  },
]

const responseNode: ScriptApiCompletionNode = {
  label: 'response',
  type: 'namespace',
  detail: 'parsed response object',
  children: [
    { label: 'status', type: 'property', detail: 'response.status' },
    { label: 'statusText', type: 'property', detail: 'response.statusText' },
    { label: 'headers', type: 'property', detail: 'response.headers' },
    {
      label: 'body',
      type: 'property',
      detail: "response.body: { type: 'json' | 'text', data }",
      children: [
        { label: 'type', type: 'property', detail: 'response.body.type' },
        { label: 'data', type: 'property', detail: 'response.body.data' },
      ],
    },
  ],
}

export function scriptAutocompleteExtension(options: {
  includeResponse: boolean
  getEnvironmentNames?: () => string[]
  getVariableNames?: () => string[]
}): Extension {
  const roots = options.includeResponse ? [...sharedNodes, responseNode] : sharedNodes

  return [
    autocompletion({
      activateOnTyping: true,
      override: [
        context => completeVariableName(context, options.getVariableNames),
        context => completeEnvironmentName(context, options.getEnvironmentNames),
        context => completeScriptApi(context, roots),
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

      const textBeforeCursor = update.state.doc.sliceString(Math.max(0, selection.from - 120), selection.from)
      if (
        !/(?:^|[^\w$])(?:env|scope|request|response)(?:\.[A-Za-z_$][\w$]*)*\.?$/.test(textBeforeCursor) &&
        !/env\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) &&
        !/scope\.(?:get|has|set)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) &&
        !/request\.headers\.(?:get|has|set|delete)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) &&
        !/env\.(?:get|has)\(\s*(['"])[^'"]*$/.test(textBeforeCursor) &&
        !/env\.set\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor) &&
        !/env\.(?:get|has)\(\s*(['"])[^'"]*['"]\s*,\s*(['"])[^'"]*$/.test(textBeforeCursor)
      ) {
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
    const names = Array.from(new Set(getVariableNames().filter(name => name.trim() !== ''))).sort((a, b) => a.localeCompare(b))
    const options = names
      .filter(name => name.toLowerCase().includes(query.toLowerCase()))
      .map(name => ({
        label: name,
        type: 'variable' as const,
        detail: 'variable',
        apply: `${name}${quote}`,
      }))

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

    const query = match[match.length - 1] ?? ''
    const quote = match[match.length - 2] ?? '"'
    const names = Array.from(new Set(getEnvironmentNames().filter(name => name.trim() !== ''))).sort((a, b) => a.localeCompare(b))
    const options = names
      .filter(name => name.toLowerCase().includes(query.toLowerCase()))
      .map(name => ({
        label: name,
        type: 'constant' as const,
        detail: 'environment',
        apply: `${name}${quote}`,
      }))

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

function completeScriptApi(context: CompletionContext, roots: ScriptApiCompletionNode[]): CompletionResult | null {
  if (context.explicit) {
    const word = context.matchBefore(/[A-Za-z_$][\w$]*/)
    const query = word?.text ?? ''
    const options = roots
      .filter(node => query === '' || node.label.toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => left.label.localeCompare(right.label))
      .map(node => toCompletion(node))

    if (options.length > 0) {
      return {
        from: word?.from ?? context.pos,
        to: context.pos,
        options,
        filter: false,
        validFor: /^[A-Za-z_$\d]*$/,
      }
    }
  }

  const match = context.matchBefore(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.?[A-Za-z_$\d]*$/)
  if (!match) {
    return null
  }

  if (match.from === match.to && !context.explicit) {
    return null
  }

  const text = match.text
  const hasTrailingDot = text.endsWith('.')
  const segments = text.split('.')
  const query = hasTrailingDot ? '' : (segments.pop() ?? '')
  const path = hasTrailingDot ? segments.filter(Boolean) : segments.filter(Boolean)
  const parentNodes = findNodesForPath(roots, path)
  if (!parentNodes) {
    return null
  }

  const options = parentNodes
    .filter(node => query === '' || node.label.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => left.label.localeCompare(right.label))
    .map(node => toCompletion(node))

  if (options.length === 0) {
    return null
  }

  return {
    from: match.to - query.length,
    options,
    filter: false,
    validFor: /^[A-Za-z_$\d]*$/,
  }
}

function findNodesForPath(roots: ScriptApiCompletionNode[], path: string[]) {
  if (path.length === 0) {
    return roots
  }

  let currentNodes = roots
  for (const segment of path) {
    const nextNode = currentNodes.find(node => node.label === segment)
    if (!nextNode?.children) {
      return null
    }
    currentNodes = nextNode.children
  }

  return currentNodes
}

function toCompletion(node: ScriptApiCompletionNode): Completion {
  return {
    label: node.label,
    type: node.type,
    detail: node.detail,
    apply(view, completion, from, to) {
      const replacement = node.apply ?? completion.label
      view.dispatch({
        changes: { from, to, insert: replacement },
        selection: { anchor: from + replacement.length },
      })
    },
  }
}
