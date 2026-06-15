import { createStore } from '@xstate/store'

type ScriptAiReviewEntry = {
  prompt: string
  promptHistory: string[]
}

type ScriptAiReviewContext = {
  entriesByTargetKey: Record<string, ScriptAiReviewEntry>
}

export const scriptAiReviewStore = createStore({
  context: {
    entriesByTargetKey: {},
  } as ScriptAiReviewContext,
  on: {
    promptChanged: (context, event: { targetKey: string; prompt: string }) => ({
      ...context,
      entriesByTargetKey: {
        ...context.entriesByTargetKey,
        [event.targetKey]: {
          ...getScriptAiReviewEntry(context, event.targetKey),
          prompt: event.prompt,
        },
      },
    }),
    promptSubmitted: (context, event: { targetKey: string; prompt: string }) => ({
      ...context,
      entriesByTargetKey: {
        ...context.entriesByTargetKey,
        [event.targetKey]: {
          prompt: '',
          promptHistory: [...getScriptAiReviewEntry(context, event.targetKey).promptHistory, event.prompt],
        },
      },
    }),
  },
})

function getScriptAiReviewEntry(context: ScriptAiReviewContext, targetKey: string): ScriptAiReviewEntry {
  return context.entriesByTargetKey[targetKey] ?? {
    prompt: '',
    promptHistory: [],
  }
}
