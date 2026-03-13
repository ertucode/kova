export type KeyValueRow = {
  id: string
  enabled: boolean
  key: string
  value: string
  description: string
}

export function parseKeyValueRows(value: string): KeyValueRow[] {
  return value
    .split('\n')
    .map((line, index) => parseKeyValueRow(line, index))
    .filter((row): row is KeyValueRow => row !== null)
}

export function stringifyKeyValueRows(rows: KeyValueRow[]) {
  const populatedRows = rows.filter(hasKeyValueContent)
  if (populatedRows.length === 0) {
    return ''
  }

  return populatedRows
    .map(row => {
      const prefix = row.enabled ? '' : '//'
      const description = row.description.trim() ? ` // ${row.description.trim()}` : ''
      return `${prefix}${row.key.trim()}:${row.value.trim()}${description}`
    })
    .join('\n')
}

export function createEmptyKeyValueRow(): KeyValueRow {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    key: '',
    value: '',
    description: '',
  }
}

function parseKeyValueRow(line: string, index: number): KeyValueRow | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return null
  }

  const enabled = !trimmedLine.startsWith('//')
  const content = enabled ? trimmedLine : trimmedLine.slice(2)
  const descriptionIndex = content.indexOf(' // ')
  const entry = descriptionIndex >= 0 ? content.slice(0, descriptionIndex) : content
  const description = descriptionIndex >= 0 ? content.slice(descriptionIndex + 4) : ''
  const separatorIndex = entry.indexOf(':')

  if (separatorIndex < 0) {
    return {
      id: `key-value-${index}`,
      enabled,
      key: entry.trim(),
      value: '',
      description,
    }
  }

  return {
    id: `key-value-${index}`,
    enabled,
    key: entry.slice(0, separatorIndex).trim(),
    value: entry.slice(separatorIndex + 1).trim(),
    description,
  }
}

function hasKeyValueContent(row: KeyValueRow) {
  return row.key.trim() !== '' || row.value.trim() !== '' || row.description.trim() !== ''
}
