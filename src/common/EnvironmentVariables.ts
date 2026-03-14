import type { EnvironmentRecord } from './Environments.js'
import { parseKeyValueRows, stringifyKeyValueRows, type KeyValueRow } from './KeyValueRows.js'

export type ResolvedEnvironmentVariable = {
  key: string
  value: string
  row: KeyValueRow
  overridden: boolean
}

export function resolveEnvironmentVariables(environment: Pick<EnvironmentRecord, 'variables'>) {
  const rows = parseKeyValueRows(environment.variables)
  const resolved = new Map<string, ResolvedEnvironmentVariable>()

  for (const row of rows) {
    const key = row.key.trim()
    if (!row.enabled || !key) {
      continue
    }

    const existing = resolved.get(key)
    resolved.set(key, {
      key,
      value: row.value,
      row,
      overridden: existing ? true : false,
    })
  }

  return resolved
}

export function getResolvedEnvironmentValue(environment: Pick<EnvironmentRecord, 'variables'>, variableName: string) {
  return resolveEnvironmentVariables(environment).get(variableName.trim())?.value ?? null
}

export function buildEnvironmentVariableMap(environments: EnvironmentRecord[]) {
  const variables: Record<string, string> = {}

  for (const environment of environments
    .slice()
    .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)) {
    for (const [key, value] of resolveEnvironmentVariables(environment)) {
      if (key in variables) {
        continue
      }

      variables[key] = value.value
    }
  }

  return variables
}

export function buildEffectiveEnvironmentOwners(environments: EnvironmentRecord[]) {
  const owners = new Map<string, string>()

  for (const environment of environments.slice().sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)) {
    for (const [key] of resolveEnvironmentVariables(environment)) {
      if (owners.has(key)) {
        continue
      }

      owners.set(key, environment.id)
    }
  }

  return owners
}

export function collectDuplicateEnvironmentKeys(environment: Pick<EnvironmentRecord, 'variables'>) {
  const rows = parseKeyValueRows(environment.variables)
  const counts = new Map<string, number>()

  for (const row of rows) {
    const key = row.key.trim()
    if (!row.enabled || !key) {
      continue
    }

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
}

export function stringifyEnvironmentVariables(rows: KeyValueRow[]) {
  return stringifyKeyValueRows(rows)
}
