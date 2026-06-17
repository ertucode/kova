import {
  VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT,
  type ViewRuntimeClipboardWriteMessage,
} from '../folders/viewRuntimeProtocol'

export function createViewRuntimeClipboardApi(postMessage: (message: ViewRuntimeClipboardWriteMessage) => void) {
  return {
    write(value: string) {
      if (typeof value !== 'string') {
        throw new Error('clipboard.write requires a string')
      }

      postMessage({
        type: VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT,
        value,
      })
    },
  }
}
