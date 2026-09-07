import { describe, expect, it } from 'vitest'
import { parseCurlRequest } from './curl.js'

describe('parseCurlRequest', () => {
  it('parses headers with explicitly empty values', () => {
    const request = parseCurlRequest("curl 'https://example.com' -H 'ngsw-bypass;'")

    expect(request?.headers).toBe('ngsw-bypass:')
  })
})
