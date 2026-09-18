import { describe, expect, it, vi } from 'vitest'
import { resolveTemplateExpressions } from './RequestVariables.js'

describe('resolveTemplateExpressions', () => {
  it('keeps supported dollar-prefixed dynamic variable names intact', async () => {
    const resolve = vi.fn(async (source: string) => `[${source}]`)

    await expect(resolveTemplateExpressions('{{$guid}} {{$randomUUID}} {{$randomPhoneNumber}}', resolve))
      .resolves.toBe('[$guid] [$randomUUID] [$randomPhoneNumber]')
  })

  it('leaves dollarless names for the regular variable resolver', async () => {
    const resolve = vi.fn(async (source: string) => `[${source}]`)

    await expect(resolveTemplateExpressions('{{baseUrl}} {{randomPhoneNumber}}', resolve))
      .resolves.toBe('{{baseUrl}} {{randomPhoneNumber}}')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('keeps escaped dollar-prefixed dynamic variables literal', async () => {
    const resolve = vi.fn(async (source: string) => `[${source}]`)

    await expect(resolveTemplateExpressions(String.raw`\{{$guid}}`, resolve)).resolves.toBe('{{$guid}}')
    expect(resolve).not.toHaveBeenCalled()
  })
})
