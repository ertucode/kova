import { describe, expect, it } from 'vitest'
import { getSharedScriptTemplateAliasNames } from './SharedScriptTemplateAliases.js'

describe('getSharedScriptTemplateAliasNames', () => {
  it('returns exports from active pre-request modules', () => {
    expect(getSharedScriptTemplateAliasNames([{
      kind: 'module',
      targets: ['pre-request'],
      isActive: true,
      code: 'export function randomPhone() { return "1" }\nexport const orderPrefix = "ORD"',
    }])).toEqual(['randomPhone', 'orderPrefix'])
  })

  it('ignores inactive modules and modules for other targets', () => {
    expect(getSharedScriptTemplateAliasNames([
      { kind: 'module', targets: ['pre-request'], isActive: false, code: 'export function inactive() {}' },
      { kind: 'module', targets: ['test'], isActive: true, code: 'export function testOnly() {}' },
      { kind: 'global', targets: ['pre-request'], isActive: true, code: 'export function globalValue() {}' },
    ])).toEqual([])
  })
})
