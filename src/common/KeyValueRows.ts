export type KeyValueRow = {
  id: string
  enabled: boolean
  key: string
  type?: KeyValueRowType
  value: string
  description: string
}

export type KeyValueRowType = '' | 'text' | 'file'

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
      const type = row.type === undefined ? null : normalizeKeyValueRowType(row.type)
      return `${prefix}${row.key.trim()}:${type ? `${type}:` : ''}${row.value.trim()}${description}`
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

  const key = entry.slice(0, separatorIndex).trim()
  const remainder = entry.slice(separatorIndex + 1)
  const secondSeparatorIndex = remainder.indexOf(':')

  if (secondSeparatorIndex >= 0) {
    const typeCandidate = remainder.slice(0, secondSeparatorIndex).trim()
    if (isKeyValueRowType(typeCandidate)) {
      return {
        id: `key-value-${index}`,
        enabled,
        key,
        type: normalizeKeyValueRowType(typeCandidate),
        value: remainder.slice(secondSeparatorIndex + 1).trim(),
        description,
      }
    }
  }

  return {
    id: `key-value-${index}`,
    enabled,
    key,
    value: remainder.trim(),
    description,
  }
}

function normalizeKeyValueRowType(type: KeyValueRow['type']): Exclude<KeyValueRowType, ''> {
  return type === 'file' ? 'file' : 'text'
}

function isKeyValueRowType(type: string): type is KeyValueRowType {
  return type === '' || type === 'text' || type === 'file'
}

function hasKeyValueContent(row: KeyValueRow) {
  return row.key.trim() !== '' || row.value.trim() !== '' || row.description.trim() !== ''
}
