import { getWindowElectron } from "@/getWindowElectron";
import { TaskDefinition } from "@common/Tasks";
import { createStore } from "@xstate/store";

type TaskStoreContext = {
  tasks: Record<string, TaskDefinition>;
};
export const taskStore = createStore({
  context: {
    tasks: {},
  } as TaskStoreContext,
  on: {
    createTask: (
      context: TaskStoreContext,
      event: {
        task: TaskDefinition;
      },
    ) => ({
      tasks: {
        [event.task.id]: event.task,
        ...context.tasks,
      },
    }),
    progressTask: (
      context: TaskStoreContext,
      event: {
        id: string;
        progress: number;
      },
    ) => ({
      tasks: {
        ...context.tasks,
        [event.id]: {
          ...context.tasks[event.id],
          progress: event.progress,
        } as TaskDefinition,
      },
    }),
    updateMetadata: (
      context: TaskStoreContext,
      event: {
        id: string;
        metadata: Partial<TaskDefinition["metadata"]>;
      },
    ) => ({
      tasks: {
        ...context.tasks,
        [event.id]: {
          ...context.tasks[event.id],
          metadata: {
            ...context.tasks[event.id].metadata,
            ...event.metadata,
          },
        } as TaskDefinition,
      },
    }),
    setResult: (
      context: TaskStoreContext,
      event: {
        id: string;
        result: TaskDefinition["result"];
      },
    ) => ({
      tasks: {
        ...context.tasks,
        [event.id]: {
          ...context.tasks[event.id],
          result: event.result,
        } as TaskDefinition,
      },
    }),
    removeTask: (
      context: TaskStoreContext,
      event: {
        id: string;
      },
    ) => {
      const { [event.id]: _, ...tasks } = context.tasks;
      return {
        tasks,
      };
    },
    pushInfo: (
      context: TaskStoreContext,
      event: {
        id: string;
        info: string[];
      },
    ) => ({
      tasks: {
        ...context.tasks,
        [event.id]: {
          ...context.tasks[event.id],
          info: [...(context.tasks[event.id].info ?? []), ...event.info],
        } as TaskDefinition,
      },
    }),
  },
});

getWindowElectron().onTaskEvent((e) => {
  if (e.type === "create") {
    taskStore.trigger.createTask({ task: e.task });
  } else if (e.type === "progress") {
    taskStore.trigger.progressTask({ id: e.id, progress: e.progress });
  } else if (e.type === "result") {
    taskStore.trigger.setResult({ id: e.id, result: e.result });
  } else if (e.type === "abort") {
    taskStore.trigger.removeTask({ id: e.id });
    // TODO: toast maybe
  } else if (e.type === "update") {
    taskStore.trigger.updateMetadata({ id: e.id, metadata: e.metadata });
  } else if (e.type === "push-info") {
    taskStore.trigger.pushInfo({ id: e.id, info: e.info });
  } else {
    const _exhaustiveCheck: never = e;
    return _exhaustiveCheck;
  }
});
