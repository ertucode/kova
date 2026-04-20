export function buildPastedValue({
  value,
  pasteText,
  selectionFrom,
  selectionTo,
}: {
  value: string
  pasteText: string
  selectionFrom: number
  selectionTo: number
}) {
  const safeSelectionFrom = Math.max(0, Math.min(selectionFrom, value.length))
  const safeSelectionTo = Math.max(safeSelectionFrom, Math.min(selectionTo, value.length))

  return `${value.slice(0, safeSelectionFrom)}${pasteText}${value.slice(safeSelectionTo)}`
}

export function isFullValueReplacement({
  value,
  selectionFrom,
  selectionTo,
}: {
  value: string
  selectionFrom: number
  selectionTo: number
}) {
  return selectionFrom === 0 && selectionTo === value.length
}
