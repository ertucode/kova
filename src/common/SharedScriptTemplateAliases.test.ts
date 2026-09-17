import { describe, expect, it } from 'vitest'
import { getSharedScriptCodeExportNames } from './SharedScriptTemplateAliases.js'

describe('getSharedScriptCodeExportNames', () => {
  it('returns exported functions, variables, destructured bindings, and export lists', () => {
    expect(getSharedScriptCodeExportNames(`
      export function randomPhone() { return '1' }
      export const orderPrefix = 'ORD'
      export const { nested } = { nested: true }
      const later = 1
      export { later as renamed }
    `)).toEqual(['randomPhone', 'orderPrefix', 'nested', 'renamed'])
  })

  it('ignores type-only, default, and non-exported declarations', () => {
    expect(getSharedScriptCodeExportNames(`
      function local() {}
      export type Value = string
      export default function ignored() {}
      type Other = number
      export type { Other }
    `)).toEqual([])
  })
})
