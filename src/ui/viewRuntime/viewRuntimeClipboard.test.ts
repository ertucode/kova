import { describe, expect, it, vi } from 'vitest'
import {
  VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT,
  type ViewRuntimeClipboardWriteMessage,
} from '../folders/viewRuntimeProtocol'
import { createViewRuntimeClipboardApi } from './viewRuntimeClipboard'

describe('createViewRuntimeClipboardApi', () => {
  it('posts clipboard writes to the parent bridge', () => {
    const postMessage = vi.fn<(message: ViewRuntimeClipboardWriteMessage) => void>()
    const clipboard = createViewRuntimeClipboardApi(postMessage)

    clipboard.write('hello from view runtime')

    expect(postMessage).toHaveBeenCalledWith({
      type: VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT,
      value: 'hello from view runtime',
    })
  })

  it('rejects non-string clipboard writes', () => {
    const clipboard = createViewRuntimeClipboardApi(vi.fn())

    expect(() => clipboard.write(123 as never)).toThrowError('clipboard.write requires a string')
  })
})
