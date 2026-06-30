import { describe, expect, it } from 'vitest'
import { normalizeManagementAgentPlan } from './ManagementAgent.js'

describe('normalizeManagementAgentPlan', () => {
  it('preserves omitted request update fields as omitted', () => {
    const plan = normalizeManagementAgentPlan({
      requestsToUpdate: [
        {
          requestId: 'request-1',
          url: ' https://example.com/patched ',
          saveToHistory: false,
        },
      ],
    })

    expect(plan.requestsToUpdate).toEqual([
      {
        requestId: 'request-1',
        url: 'https://example.com/patched',
        saveToHistory: false,
      },
    ])
  })
})
