import { toast } from '@/lib/components/toast'
import type { CodeEditorSelection } from './CodeEditor'
import { formatScriptBlock, formatScriptBlockWithCursor } from './formatScriptBlock'

export type PendingScriptSelection = {
  selection: CodeEditorSelection
  code: string
}

export async function formatScriptValueForSave(
  value: string,
  selection: CodeEditorSelection | null,
  pendingSelectionRef: { current: PendingScriptSelection | null },
  label: string
) {
  if (value.trim().length === 0) {
    pendingSelectionRef.current = null
    return value
  }

  try {
    if (!selection) {
      pendingSelectionRef.current = null
      return await formatScriptBlock(value)
    }

    const cursorOffset = Math.max(0, Math.min(selection.head, value.length))
    const result = await formatScriptBlockWithCursor(value, cursorOffset)
    pendingSelectionRef.current =
      result.formatted === value
        ? null
        : {
            code: result.formatted,
            selection: { anchor: result.cursorOffset, head: result.cursorOffset },
          }
    return result.formatted
  } catch {
    pendingSelectionRef.current = null
    toast.show({
      severity: 'warning',
      title: 'Script formatting failed',
      message: `${label} was saved without formatting.`,
    })
    return value
  }
}
