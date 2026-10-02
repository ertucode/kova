import { describe, expect, it } from 'vitest'
import { runFolderIterationScheduler } from './folder-run-scheduler.js'

describe('folder run iteration scheduler', () => {
  it('runs the requested finite iteration count within the concurrency limit', async () => {
    let activeCount = 0
    let maximumActiveCount = 0
    const completedIndexes: number[] = []

    const result = await runFolderIterationScheduler({
      concurrency: 5,
      targetIterationCount: 37,
      shouldStop: () => false,
      runIteration: async index => {
        activeCount += 1
        maximumActiveCount = Math.max(maximumActiveCount, activeCount)
        await new Promise(resolve => setTimeout(resolve, 1))
        completedIndexes.push(index)
        activeCount -= 1
      },
    })

    expect(result.workerFailed).toBe(false)
    expect(maximumActiveCount).toBe(5)
    expect(completedIndexes.sort((left, right) => left - right)).toEqual(
      Array.from({ length: 37 }, (_, index) => index)
    )
  })

  it('stops an unbounded run without scheduling more work', async () => {
    let stopped = false
    const startedIndexes: number[] = []

    await runFolderIterationScheduler({
      concurrency: 3,
      targetIterationCount: null,
      shouldStop: () => stopped,
      runIteration: async index => {
        startedIndexes.push(index)
        if (startedIndexes.length === 3) stopped = true
      },
    })

    expect(startedIndexes).toEqual([0, 1, 2])
  })

  it('drains active work and stops scheduling after a worker failure', async () => {
    const startedIndexes: number[] = []
    const result = await runFolderIterationScheduler({
      concurrency: 2,
      targetIterationCount: 10,
      shouldStop: () => false,
      runIteration: async index => {
        startedIndexes.push(index)
        if (index === 0) throw new Error('failed')
        await new Promise(resolve => setTimeout(resolve, 1))
      },
    })

    expect(result.workerFailed).toBe(true)
    expect(startedIndexes).toEqual([0, 1])
  })
})
