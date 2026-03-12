import { getWindowElectron } from '@/getWindowElectron'
import { taskStore } from './taskStore'

export function subscribeToTasks() {
  getWindowElectron().onTaskEvent(event => {
    if (event.type !== 'result') return

    const tasks = taskStore.getSnapshot().context.tasks
    const task = tasks[event.id]
    if (!task) return
  })
}
