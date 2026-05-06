import { describe, expect, it } from 'vitest'
import { parseKeyValueRows, stringifyKeyValueRows } from './KeyValueRows.js'

describe('KeyValueRows', () => {
  it('parses legacy rows as text rows without forcing typed syntax', () => {
    expect(parseKeyValueRows('name:Ada')).toEqual([
      {
        id: 'key-value-0',
        enabled: true,
        key: 'name',
        value: 'Ada',
        description: '',
      },
    ])
  })

  it('parses and stringifies typed rows', () => {
    const rows = parseKeyValueRows('name:text:Ada\navatar:file:C:\\tmp\\avatar.png // Profile image')

    expect(rows).toEqual([
      {
        id: 'key-value-0',
        enabled: true,
        key: 'name',
        type: 'text',
        value: 'Ada',
        description: '',
      },
      {
        id: 'key-value-1',
        enabled: true,
        key: 'avatar',
        type: 'file',
        value: 'C:\\tmp\\avatar.png',
        description: 'Profile image',
      },
    ])

    expect(
      stringifyKeyValueRows([
        { id: '1', enabled: true, key: 'name', type: 'text', value: 'Ada', description: '' },
        { id: '2', enabled: true, key: 'avatar', type: 'file', value: 'C:\\tmp\\avatar.png', description: 'Profile image' },
      ])
    ).toBe('name:text:Ada\navatar:file:C:\\tmp\\avatar.png // Profile image')
  })
})
