// @vitest-environment node
import JSON5 from 'json5'
import { bench, describe, expect } from 'vitest'
import { normalizeJson5ToJson } from './Json5.js'

// Build fixtures outside the timed callbacks. Both implementations receive the
// same source; parse/stringify is a speed baseline, not a lossless alternative.
function createBody(rows: number, json5: boolean) {
  const entries = Array.from({ length: rows }, (_, index) =>
    json5
      ? `{id: 21093120398102398123, name: 'Item ${index}', active: true, price: 0.123456789012345678901, tags: ['one', 'two',], /* item */}`
      : `{"id":21093120398102398123,"name":"Item ${index}","active":true,"price":0.123456789012345678901,"tags":["one","two"]}`
  )
  return `[${entries.join(',\n')}]`
}

const scenarios = [
  { name: 'user example', source: '{"asdfasdf": 21093120398102398123, asdasdasd: 45, // lkasjdfl\n}' },
  { name: 'JSON5 / 100 rows', source: createBody(100, true) },
  { name: 'JSON5 / 10,000 rows', source: createBody(10_000, true) },
  { name: 'strict JSON / 100 rows', source: createBody(100, false) },
  { name: 'strict JSON / 10,000 rows', source: createBody(10_000, false) },
  {
    name: 'escaped strings / 100 rows',
    source: `[${Array.from(
      { length: 100 },
      () => String.raw`{\u0061: 'it\'s "ok"', path: 'C:\\files\\test', lines: 'one\ntwo', hex: '\x41',}`
    ).join(',')}]`,
  },
]

for (const { name, source } of scenarios) {
  describe(`${name} (${Buffer.byteLength(source).toLocaleString('en-US')} bytes)`, () => {
    // Check syntax and semantic equivalence before timing. Precision is asserted
    // separately by Json5.test.ts and the sendRequest transport tests.
    expect(JSON.parse(normalizeJson5ToJson(source))).toEqual(JSON5.parse(source))

    bench(
      'JSON5.parse + JSON.stringify (lossy)',
      () => { JSON.stringify(JSON5.parse(source)) },
      { time: 1_000, iterations: 10, warmupTime: 300 }
    )

    bench(
      'normalizeJson5ToJson (lossless)',
      () => { normalizeJson5ToJson(source) },
      { time: 1_000, iterations: 10, warmupTime: 300 }
    )
  })
}
