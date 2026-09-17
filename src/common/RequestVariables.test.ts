import { describe, expect, it, vi } from 'vitest'
import { resolveTemplateExpressions } from './RequestVariables.js'

describe('resolveTemplateExpressions', () => {
  it('maps friendly dynamic aliases to their Postman-compatible expression names', async () => {
    const resolve = vi.fn(async (source: string) => `[${source}]`)

    await expect(resolveTemplateExpressions('{{randomGuid}} {{randomPhoneNumber}}', resolve))
      .resolves.toBe('[$guid] [$randomPhoneNumber]')
  })

  it('leaves normal environment variables for the regular variable resolver', async () => {
    const resolve = vi.fn(async (source: string) => source.includes('baseUrl') ? '{{baseUrl}}' : `[${source}]`)

    await expect(resolveTemplateExpressions('{{baseUrl}}', resolve)).resolves.toBe('{{baseUrl}}')
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('keeps escaped aliases literal', async () => {
    const resolve = vi.fn(async (source: string) => `[${source}]`)

    await expect(resolveTemplateExpressions(String.raw`\{{randomGuid}}`, resolve)).resolves.toBe(String.raw`\{{randomGuid}}`)
    expect(resolve).not.toHaveBeenCalled()
  })
})
