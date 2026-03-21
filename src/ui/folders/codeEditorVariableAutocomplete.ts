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

export type VariableAutocompleteItem = {
  name: string
  effectiveEnvironmentName: string | null
  activeEnvironmentNames: string[]
  inactiveEnvironmentNames: string[]
}

type VariableAutocompleteOptions = {
  fallbackToBrowserTab?: boolean
}

export function variableAutocompleteExtension(
  getVariables: () => VariableAutocompleteItem[],
  opts?: VariableAutocompleteOptions
): Extension {
  return [
    codeEditorTabBehaviorExtension(opts),
    autocompletion({
      activateOnTyping: true,
      override: [context => completeVariables(context, getVariables)],
    }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged) {
        return
      }

      const selection = update.state.selection.main
      if (!selection.empty) {
        return
      }

      const textBeforeCursor = update.state.doc.sliceString(Math.max(0, selection.from - 200), selection.from)
      if (!/\{\{[a-zA-Z0-9._-]*$/.test(textBeforeCursor)) {
        return
      }

      if (completionStatus(update.state) !== null) {
        return
      }

      startCompletion(update.view)
    }),
  ]
}

function completeVariables(
  context: CompletionContext,
  getVariables: () => VariableAutocompleteItem[]
): CompletionResult | null {
  const match = context.matchBefore(/\{\{[a-zA-Z0-9._-]*$/)
  if (!match) {
    return null
  }

  if (match.from === match.to && !context.explicit) {
    return null
  }

  const query = match.text.slice(2).toLowerCase()
  const variables = getVariables()
  const options = variables
    .filter(variable => variable.name.trim() !== '')
    .filter(variable => variable.name.toLowerCase().includes(query))
    .sort(compareAutocompleteItems(query))
    .map(variable => toCompletion(variable))

  if (options.length === 0) {
    return null
  }

  return {
    from: match.from,
    options,
    // Burda filter true verince completionımız {{}} bracketlı olduğu için her değeri filtreliyor.
    // validFor'u da verince bu sefer yazarken update olmuyor liste. O yüzden validFor vermiyoruz.
    filter: false,
    // validFor: /^\{\{[a-zA-Z0-9._-]*$/,
  }
}

function toCompletion(variable: VariableAutocompleteItem): Completion {
  return {
    label: variable.name,
    type: 'variable',
    detail: buildEnvironmentDetail(variable),
    boost: getCompletionBoost(variable),
    apply(view, completion, from, to) {
      const replacement = `{{${completion.label}}}`
      const trailingText = view.state.doc.sliceString(to, Math.min(view.state.doc.length, to + 2))
      const replacementTo = trailingText === '}}' ? to + 2 : to

      view.dispatch({
        changes: { from, to: replacementTo, insert: replacement },
        selection: { anchor: from + replacement.length },
      })
    },
  }
}

function buildEnvironmentDetail(variable: VariableAutocompleteItem) {
  if (variable.effectiveEnvironmentName) {
    const moreActive = variable.activeEnvironmentNames.filter(name => name !== variable.effectiveEnvironmentName)
    const suffix = moreActive.length > 0 ? ` +${moreActive.length}` : ''
    return `${variable.effectiveEnvironmentName}${suffix}`
  }

  if (variable.activeEnvironmentNames.length > 0) {
    return variable.activeEnvironmentNames.join(', ')
  }

  return variable.inactiveEnvironmentNames.join(', ')
}

function getCompletionBoost(variable: VariableAutocompleteItem) {
  if (variable.effectiveEnvironmentName) {
    return 120
  }

  if (variable.activeEnvironmentNames.length > 0) {
    return 80
  }

  return 20
}

function compareAutocompleteItems(query: string) {
  return (left: VariableAutocompleteItem, right: VariableAutocompleteItem) => {
    const leftScore = getRank(left)
    const rightScore = getRank(right)
    if (leftScore !== rightScore) {
      return leftScore - rightScore
    }

    const leftStartsWith = left.name.toLowerCase().startsWith(query)
    const rightStartsWith = right.name.toLowerCase().startsWith(query)
    if (leftStartsWith !== rightStartsWith) {
      return leftStartsWith ? -1 : 1
    }

    return left.name.localeCompare(right.name)
  }
}

function getRank(variable: VariableAutocompleteItem) {
  if (variable.effectiveEnvironmentName) {
    return 0
  }

  if (variable.activeEnvironmentNames.length > 0) {
    return 1
  }

  return 2
}
