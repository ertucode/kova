export { buildEnvironmentVariableMap } from './EnvironmentVariables.js'
import { POSTMAN_DYNAMIC_VARIABLE_ALIASES, POSTMAN_DYNAMIC_VARIABLE_NAMES } from './PostmanDynamicVariables.js'

const VARIABLE_TOKEN_REGEX = /\\?\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g
const EXPRESSION_TOKEN_REGEX = /\\?\{\{(?:\$([\s\S]*?)|\s*([a-zA-Z0-9._-]+)\s*)\}\}/g

export function extractTemplateVariables(value: string) {
  const variableNames = new Set<string>()

  for (const match of value.matchAll(VARIABLE_TOKEN_REGEX)) {
    if (match[0].startsWith('\\')) {
      continue
    }

    const variableName = match[1]?.trim()
    if (variableName) {
      variableNames.add(variableName)
    }
  }

  return Array.from(variableNames)
}

export function resolveTemplateVariables(value: string, variables: Record<string, string>) {
  return value.replace(VARIABLE_TOKEN_REGEX, (match, variableName: string) => {
    if (match.startsWith('\\')) {
      return match.slice(1)
    }

    const resolved = variables[variableName.trim()]
    return resolved ?? match
  })
}

export function findMissingTemplateVariables(value: string, variables: Record<string, string>) {
  return extractTemplateVariables(value).filter(variableName => !(variableName in variables))
}

export async function resolveTemplateExpressions(
  value: string,
  resolveExpression: (expressionSource: string) => Promise<string>
) {
  const matches = Array.from(value.matchAll(EXPRESSION_TOKEN_REGEX))
  if (matches.length === 0) {
    return value
  }

  let nextValue = ''
  let cursor = 0

  for (const match of matches) {
    const matchIndex = match.index
    if (matchIndex === undefined) {
      continue
    }

    nextValue += value.slice(cursor, matchIndex)
    cursor = matchIndex + match[0].length

    const explicitExpression = match[1]
    const alias = match[2]
    const dynamicVariable = alias ? POSTMAN_DYNAMIC_VARIABLE_ALIASES.get(alias) : undefined
    if (match[0].startsWith('\\')) {
      nextValue += explicitExpression === undefined ? match[0] : match[0].slice(1)
      continue
    }

    const postmanExpression = explicitExpression !== undefined && POSTMAN_DYNAMIC_VARIABLE_NAMES.has(`$${explicitExpression.trim()}`)
      ? `$${explicitExpression.trim()}`
      : explicitExpression
    const expression = postmanExpression ?? dynamicVariable
    nextValue += expression === undefined ? match[0] : await resolveExpression(expression)
  }

  nextValue += value.slice(cursor)
  return nextValue
}
