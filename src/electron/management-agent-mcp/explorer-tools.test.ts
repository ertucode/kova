import { describe, expect, it } from 'vitest'
import { getEnvironmentValueFromRecords, summarizeEnvironmentsForAgent } from './explorer-tools.js'

describe('environment management-agent explorer helpers', () => {
  const environments = [
    {
      id: 'env-1',
      name: 'Local',
      variables: 'baseUrl:https://api.example.com\nsecret:token-123\n//disabled:ignore-me',
      color: null,
      warnOnRequest: false,
      position: 0,
      priority: 0,
      createdAt: 1,
      deletedAt: null,
    },
  ]

  it('lists environment names without exposing values', () => {
    expect(summarizeEnvironmentsForAgent(environments)).toEqual([
      {
        id: 'env-1',
        name: 'Local',
        variableNames: ['baseUrl', 'secret', 'disabled'],
      },
    ])
  })

  it('returns one variable value by exact environment name', () => {
    expect(getEnvironmentValueFromRecords(environments, 'Local', 'secret')).toEqual({
      environmentId: 'env-1',
      environmentName: 'Local',
      name: 'secret',
      value: 'token-123',
    })
  })
})
