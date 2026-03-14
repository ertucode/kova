import { describe, expect, it } from 'vitest'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap, collectDuplicateEnvironmentKeys, getResolvedEnvironmentValue } from './EnvironmentVariables.js'

describe('EnvironmentVariables', () => {
  it('uses the last enabled duplicate within the same environment', () => {
    const environment = {
      id: 'env-1',
      name: 'Env',
      variables: 'foo:1\nfoo:2\n//foo:3',
      position: 0,
      priority: 0,
      createdAt: 1,
      deletedAt: null,
    }

    expect(getResolvedEnvironmentValue(environment, 'foo')).toBe('2')
    expect(collectDuplicateEnvironmentKeys(environment)).toEqual([{ key: 'foo', count: 2 }])
  })

  it('keeps higher priority environment precedence while each environment resolves last-wins internally', () => {
    const environments = [
      { id: 'env-1', name: 'A', variables: 'foo:1\nfoo:2', position: 0, priority: 1, createdAt: 1, deletedAt: null },
      { id: 'env-2', name: 'B', variables: 'foo:3', position: 1, priority: 0, createdAt: 2, deletedAt: null },
    ]

    expect(buildEnvironmentVariableMap(environments)).toEqual({ foo: '2' })
    expect(buildEffectiveEnvironmentOwners(environments)).toEqual(new Map([['foo', 'env-1']]))
  })
})
