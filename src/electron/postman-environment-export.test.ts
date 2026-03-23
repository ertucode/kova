import { describe, expect, it } from 'vitest'
import { analyzeEnvironmentExport, buildEnvironmentExportDocument } from './postman-environment-export.js'

describe('postman environment export', () => {
  it('warns when variable descriptions are stored in metadata', () => {
    const analysis = analyzeEnvironmentExport({
      id: 'env-1',
      name: 'preprod',
      variables: 'foo:1 // API host\n//bar:2',
      color: '#ef4444',
      warnOnRequest: false,
      position: 0,
      priority: 0,
      createdAt: 1,
      deletedAt: null,
    })

    expect(analysis.warnings.map(warning => warning.code)).toContain('variable-descriptions-stored-in-metadata')
  })

  it('exports variable descriptions in _kova metadata', () => {
    const document = buildEnvironmentExportDocument({
      id: 'env-1',
      name: 'preprod',
      variables: 'foo:1 // API host\n//bar:2',
      color: '#ef4444',
      warnOnRequest: true,
      position: 0,
      priority: 0,
      createdAt: 1,
      deletedAt: null,
    }, 'Preprod')

    expect(document.color).toBe('#ef4444')
    expect(document._kova).toEqual({ warnOnRequest: true })
    expect(document.values).toEqual([
      { key: 'foo', value: '1', enabled: true, type: 'text', _kova: { description: 'API host' } },
      { key: 'bar', value: '2', enabled: false, type: 'text', _kova: undefined },
    ])
  })
})
