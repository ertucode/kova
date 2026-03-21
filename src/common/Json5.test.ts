import { describe, expect, it } from 'vitest'
import { formatJson5, normalizeJson5ToJson } from './Json5.js'

describe('Json5', () => {
  it('formats JSON5 input as JSON5', () => {
    expect(formatJson5("{foo:'bar', trailing:[1,2,],}"))
      .toBe(`{
  foo: 'bar',
  trailing: [
    1,
    2,
  ],
}`)
  })

  it('normalizes JSON5 input to strict JSON', () => {
    expect(normalizeJson5ToJson("{foo:'bar', trailing:[1,2,],}"))
      .toBe('{"foo":"bar","trailing":[1,2]}')
  })
})
