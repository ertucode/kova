import { describe, expect, it } from 'vitest'
import { formatJson, formatJson5, formatJson5PreferringJsonWithTemplates, normalizeJson5ToJson } from './Json5.js'

describe('Json5', () => {
  it('formats JSON5 input as JSON5', async () => {
    await expect(formatJson5("{foo:'bar', trailing:[1,2,],}"))
      .resolves.toBe(`{ foo: "bar", trailing: [1, 2] }
`)
  })

  it('preserves JSON5 comments while formatting', async () => {
    await expect(formatJson5(`{
	// keep this comment
	foo:'bar', /* and this one */
}`)).resolves.toBe(`{
	// keep this comment
	foo: "bar" /* and this one */,
}
`)
  })

  it('preserves quoted object keys while formatting', async () => {
    await expect(formatJson5(`{"quoted-key":1, unquoted:2}`))
      .resolves.toBe(`{ "quoted-key": 1, unquoted: 2 }
`)
  })

  it('formats JSON5 input as strict JSON', () => {
    expect(formatJson("{foo:'bar', trailing:[1,2,],}"))
      .toBe(`{
  "foo": "bar",
  "trailing": [
    1,
    2
  ]
}`)
  })

  it('normalizes JSON5 input to strict JSON', () => {
    expect(normalizeJson5ToJson("{foo:'bar', trailing:[1,2,],}"))
      .toBe('{"foo":"bar","trailing":[1,2]}')
  })

  it('formats bare template values without breaking valid string templates', async () => {
    await expect(
      formatJson5PreferringJsonWithTemplates(`{"title":"{{$new Date()}}","userId":{{$2}}}`)
    ).resolves.toBe(`{
  "title": "{{$new Date()}}",
  "userId": {{$2}}
}`)
  })

  it('preserves comments around bare template values while formatting', async () => {
    await expect(formatJson5PreferringJsonWithTemplates(`{
	"title": "{{$const a = 2; a; crypto.randomUUID}}",
	"body": "{{$new Date()}}", // hello world
	"userId": {{$2}} /* block comment */
}`)).resolves.toBe(`{
	"title": "{{$const a = 2; a; crypto.randomUUID}}",
	"body": "{{$new Date()}}", // hello world
	"userId": {{$2}} /* block comment */,
}
`)
  })
})
