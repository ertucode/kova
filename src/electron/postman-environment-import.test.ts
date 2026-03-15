import { describe, expect, it } from 'vitest'
import { analyzeEnvironmentDocument } from './postman-environment-import.js'

describe('postman environment import', () => {
  it('reports duplicate overrides and disabled variables', () => {
    const analysis = analyzeEnvironmentDocument({
      name: 'preprod',
      values: [
        { key: 'foo', value: '1', enabled: true, _kova: { description: 'Main host' } },
        { key: 'foo', value: '2', enabled: true },
        { key: 'bar', value: '3', enabled: false },
      ],
      color: 'blue',
      _postman_exported_at: 'today',
    })

    expect(analysis.environmentName).toBe('preprod')
    expect(analysis.variables).toBe('foo:1 // Main host\nfoo:2\n//bar:3')
    expect(analysis.warnings.map(warning => warning.code)).toEqual(
      expect.arrayContaining(['duplicate-keys-overridden', 'disabled-variables-commented', 'metadata-ignored'])
    )
  })
})
