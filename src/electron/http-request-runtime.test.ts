import { describe, expect, it } from 'vitest'
import { buildResolvedRequestBody } from './http-request-runtime.js'

describe('buildResolvedRequestBody', () => {
  it('treats empty trimmed raw JSON bodies as no body', () => {
    const result = buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: '  \n\t  ',
        rawType: 'json',
      },
      {}
    )

    expect(result).toEqual({ success: true, data: { kind: 'none' } })
  })

  it('normalizes valid raw JSON5 bodies', () => {
    const result = buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: "{foo:'bar', trailing:[1,2,],}",
        rawType: 'json',
      },
      {}
    )

    expect(result).toEqual({ success: true, data: { kind: 'raw', value: '{"foo":"bar","trailing":[1,2]}' } })
  })

  it('rejects invalid raw JSON bodies', () => {
    const result = buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: '{',
        rawType: 'json',
      },
      {}
    )

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected invalid JSON body to fail')
    }

    expect(result.error).toEqual({ type: 'message', message: 'Invalid JSON body: JSON5: invalid end of input at 1:2' })
  })
})
