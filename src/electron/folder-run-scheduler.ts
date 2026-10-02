export async function runFolderIterationScheduler(input: {
  concurrency: number
  targetIterationCount: number | null
  shouldStop: () => boolean
  runIteration: (index: number) => Promise<void>
}) {
  let nextIterationIndex = 0
  let runningCount = 0
  let workerFailed = false

  await new Promise<void>(resolve => {
    const schedule = () => {
      while (
        !input.shouldStop() &&
        !workerFailed &&
        runningCount < input.concurrency &&
        (input.targetIterationCount === null || nextIterationIndex < input.targetIterationCount)
      ) {
        const iterationIndex = nextIterationIndex++
        runningCount += 1
        void input
          .runIteration(iterationIndex)
          .catch(() => {
            workerFailed = true
          })
          .finally(() => {
            runningCount -= 1
            schedule()
          })
      }
      if (
        runningCount === 0 &&
        (input.shouldStop() ||
          workerFailed ||
          (input.targetIterationCount !== null && nextIterationIndex >= input.targetIterationCount))
      ) {
        resolve()
      }
    }
    schedule()
  })

  return { workerFailed }
}
