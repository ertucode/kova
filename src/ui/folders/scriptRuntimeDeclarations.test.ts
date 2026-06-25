import { describe, expect, it } from 'vitest'
import { getScriptRuntimeDeclarations } from './scriptRuntimeDeclarations'

describe('getScriptRuntimeDeclarations', () => {
  it('exposes test runtime declarations without retryRequest', () => {
    const declarations = getScriptRuntimeDeclarations({ phase: 'test' })

    expect(declarations).toContain('declare const request: ScriptRequestApi')
    expect(declarations).toContain('declare const response: ScriptResponseApi')
    expect(declarations).toContain('declare const prompt: ScriptPromptApi')
    expect(declarations).toContain('declare const kv: KvApi')
    expect(declarations).not.toContain('declare const toast: ScriptToastApi')
    expect(declarations).not.toContain('declare function retryRequest(): never')
  })

  it('keeps shared-script declarations as target intersections', () => {
    const declarations = getScriptRuntimeDeclarations({ targets: ['post-request', 'test'] })

    expect(declarations).toContain('declare const response: ScriptResponseApi')
    expect(declarations).toContain('declare const prompt: ScriptPromptApi')
    expect(declarations).not.toContain('declare const kv: KvApi')
    expect(declarations).not.toContain('declare function retryRequest(): never')
  })
})
