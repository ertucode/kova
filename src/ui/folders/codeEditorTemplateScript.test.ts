import { describe, expect, it } from 'vitest'
import { findTemplateScriptExpressionAtPosition, findTemplateScriptExpressions } from './codeEditorTemplateScript'

describe('findTemplateScriptExpressionAtPosition', () => {
  it('finds the enclosing expression and maps its content range', () => {
    const source = 'hello {{$const id = crypto.randomUUID(); id}} world'
    const position = source.indexOf('crypto') + 3

    expect(findTemplateScriptExpressionAtPosition(source, position)).toEqual({
      from: 6,
      to: 45,
      contentFrom: 9,
      contentTo: 43,
      code: 'const id = crypto.randomUUID(); id',
    })
  })

  it('ignores escaped expressions', () => {
    const source = String.raw`\{{$crypto.randomUUID()}}`

    expect(findTemplateScriptExpressionAtPosition(source, source.indexOf('crypto'))).toBeNull()
  })

  it('strips the template marker before runtime parsing', () => {
    const [expression] = findTemplateScriptExpressions("{{$loadPackage('lodash').isArray([])}}")

    expect(expression?.code).toBe("loadPackage('lodash').isArray([])")
  })

  it('keeps the shorthand dollar as part of Postman dynamic variable expressions', () => {
    expect(findTemplateScriptExpressions('{{$guid}}')[0]).toMatchObject({
      contentFrom: 2,
      contentTo: 7,
      code: '$guid',
    })
    expect(findTemplateScriptExpressions('{{$$guid}}')[0]).toMatchObject({
      contentFrom: 3,
      contentTo: 8,
      code: '$guid',
    })
  })
})
