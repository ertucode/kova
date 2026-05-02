export type ScriptClipboardBridge = {
  writeText: (value: string) => void
}

export function createScriptClipboardApi(clipboardBridge: ScriptClipboardBridge | undefined) {
  return {
    write(value: string) {
      if (typeof value !== 'string') {
        throw new Error('clipboard.write requires a string')
      }

      clipboardBridge?.writeText(value)
    },
  }
}
