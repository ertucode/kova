import type { RequestScriptError } from './Requests.js'

export function formatRequestScriptErrorSummary(error: Pick<RequestScriptError, 'compactLabel' | 'compactMessage' | 'sourceName'>) {
  return `${error.compactLabel} (${error.sourceName}) ${error.compactMessage}`
}

export function formatRequestScriptErrorSummaries(
  errors: Array<Pick<RequestScriptError, 'compactLabel' | 'compactMessage' | 'sourceName'>>
) {
  return errors.map(formatRequestScriptErrorSummary).join('\n')
}
