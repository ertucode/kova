import type { SharedScriptRecord } from './SharedScripts.js'

const EXPORTED_FUNCTION_PATTERN = /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
const EXPORTED_VALUE_PATTERN = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g

export function getSharedScriptTemplateAliasNames(
  scripts: Array<Pick<SharedScriptRecord, 'kind' | 'targets' | 'isActive' | 'code'>>
) {
  const names = new Set<string>()

  for (const script of scripts) {
    if (!script.isActive || script.kind !== 'module' || !script.targets.includes('pre-request')) {
      continue
    }

    for (const name of getSharedScriptCodeTemplateAliasNames(script.code)) {
      names.add(name)
    }
  }

  return Array.from(names)
}

export function getSharedScriptCodeTemplateAliasNames(source: string) {
  const names = new Set<string>()
  collectMatches(source, EXPORTED_FUNCTION_PATTERN, names)
  collectMatches(source, EXPORTED_VALUE_PATTERN, names)
  return Array.from(names)
}

function collectMatches(source: string, pattern: RegExp, names: Set<string>) {
  pattern.lastIndex = 0
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (name) {
      names.add(name)
    }
  }
}
