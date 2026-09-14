import { describe, expect, it } from 'vitest'
import {
  formatJson,
  formatJson5NoTraling,
  formatJson5PreferringJsonWithTemplates,
  getJson5Diagnostic,
  normalizeJson5ToJson,
} from './Json5.js'

describe('Json5', () => {
  it('formats JSON5 input as JSON5', async () => {
    await expect(formatJson5NoTraling("{foo:'bar', trailing:[1,2,],}")).resolves.toBe(`{ foo: "bar", trailing: [1, 2] }
`)
  })

  it('preserves JSON5 comments while formatting', async () => {
    await expect(
      formatJson5NoTraling(`{
	// keep this comment
	foo:'bar', /* and this one */
}`)
    ).resolves.toBe(`{
	// keep this comment
	foo: "bar" /* and this one */
}
`)
  })

  it('preserves quoted object keys while formatting', async () => {
    await expect(formatJson5NoTraling(`{"quoted-key":1, unquoted:2}`)).resolves.toBe(`{ "quoted-key": 1, unquoted: 2 }
`)
  })

  it('formats JSON5 input as strict JSON', () => {
    expect(formatJson("{foo:'bar', trailing:[1,2,],}")).toBe(`{
  "foo": "bar",
  "trailing": [
    1,
    2
  ]
}`)
  })

  it('normalizes JSON5 input to strict JSON', () => {
    expect(normalizeJson5ToJson("{foo:'bar', trailing:[1,2,],}")).toBe('{"foo":"bar","trailing":[1,2]}')
  })

  it('preserves already-valid JSON verbatim, including whitespace and exact numbers', () => {
    const source = ' { "id": 21093120398102398123, "decimal": 0.123456789012345678901, "overflow": 1e999 }\n'
    expect(normalizeJson5ToJson(source)).toBe(source)
  })

  it('quotes literal control characters in JSON5 strings', () => {
    expect(normalizeJson5ToJson('{text: "tab\tand\u0001control"}')).toBe('{"text":"tab\\tand\\u0001control"}')
  })

  it.each([
    ['{ "asdfasdf": 21093120398102398123, asdasdasd: 45, // lkasjdfl\n}', '{"asdfasdf":21093120398102398123,"asdasdasd":45}'],
    ['{nested: [-21093120398102398123, 0.123456789012345678901, 123456789012345678901e+99,],}', '{"nested":[-21093120398102398123,0.123456789012345678901,123456789012345678901e+99]}'],
    ['[+.1234567890123456789, -.5, 2., 2.e3, +42]', '[0.1234567890123456789,-0.5,2.0,2.0e3,42]'],
    ['[0xFFFFFFFFFFFFFFFF, -0xFFFFFFFFFFFFFFFF, +0x10]', '[18446744073709551615,-18446744073709551615,16]'],
    ['[NaN, -NaN, +Infinity, -Infinity, 1e999]', '[null,null,null,null,1e999]'],
    [String.raw`{\u0061: 'it\'s "ok"', text: '/*keep*/ //keep', hex: '\x41'}`, '{"a":"it\'s \\"ok\\"","text":"/*keep*/ //keep","hex":"A"}'],
    ['{a: 1 /* comment */, b: [true, null, false,], // comment\u2028 c: 2}', '{"a":1,"b":[true,null,false],"c":2}'],
    ["{text: 'line\\\nbreak', '__proto__': 1}", '{"text":"linebreak","__proto__":1}'],
  ])('normalizes %s without losing numeric precision', (source, expected) => {
    const normalized = normalizeJson5ToJson(source)
    expect(normalized).toBe(expected)
    expect(() => JSON.parse(normalized)).not.toThrow()
  })

  it.each(['{', '{foo: undefined}', '[01]', '{foo: 1 bar: 2}', '{foo: "unterminated}'])('rejects malformed JSON5: %s', source => {
    expect(() => normalizeJson5ToJson(source)).toThrow()
  })

  it('formats bare template values without breaking valid string templates', async () => {
    await expect(formatJson5PreferringJsonWithTemplates(`{"title":"{{$new Date()}}","userId":{{$2}}}`)).resolves.toBe(`{ "title": "{{$new Date()}}", "userId": {{$2}} }
`)
  })

  it('preserves comments around bare template values while formatting', async () => {
    await expect(
      formatJson5PreferringJsonWithTemplates(`{
	"title": "{{$const a = 2; a; crypto.randomUUID}}",
	"body": "{{$new Date()}}", // hello world
	"userId": {{$2}} /* block comment */
}`)
    ).resolves.toBe(`{
	"title": "{{$const a = 2; a; crypto.randomUUID}}",
	"body": "{{$new Date()}}", // hello world
	"userId": {{$2}} /* block comment */
}
`)
  })

  it('does not report diagnostics for multiline bare template values', () => {
    expect(
      getJson5Diagnostic(`{
	"query": {{$
		const id = crypto.randomUUID()
		id
	}},
}`)
    ).toBeNull()
  })

  it('does not report diagnostics for multiline quoted template values', () => {
    expect(
      getJson5Diagnostic(`{
	"query": "{{$
		const id = crypto.randomUUID()
		id
	}}"
}`)
    ).toBeNull()
  })
})
