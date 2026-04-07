import JSON5 from 'json5'

export function formatJson5(value: string) {
  const parsed = JSON5.parse(value)
  return JSON5.stringify(parsed, null, 2)
}

export function formatJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed, null, 2)
}

export function normalizeJson5ToJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed)
}
