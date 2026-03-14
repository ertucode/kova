export { buildEnvironmentVariableMap } from './EnvironmentVariables.js'

const VARIABLE_TOKEN_REGEX = /\\?\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g

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
