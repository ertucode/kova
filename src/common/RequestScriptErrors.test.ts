import { describe, expect, it } from 'vitest'
import { formatRequestScriptErrorSummaries, formatRequestScriptErrorSummary } from './RequestScriptErrors.js'

describe('formatRequestScriptErrorSummary', () => {
  it('includes the source name in the summary text', () => {
    expect(
      formatRequestScriptErrorSummary({
        compactLabel: 'Pre-request',
        sourceName: 'Request: Create User',
        compactMessage: "Cannot read properties of null (reading 'trim')",
      })
    ).toBe("Pre-request (Request: Create User) Cannot read properties of null (reading 'trim')")
  })

  it('joins multiple summaries on separate lines', () => {
    expect(
      formatRequestScriptErrorSummaries([
        {
          compactLabel: 'Pre-request',
          sourceName: 'Folder: Auth',
          compactMessage: 'Token missing',
        },
        {
          compactLabel: 'Pre-request:12',
          sourceName: 'Request: Create User',
          compactMessage: 'Request failed',
        },
      ])
    ).toBe('Pre-request (Folder: Auth) Token missing\nPre-request:12 (Request: Create User) Request failed')
  })
})
