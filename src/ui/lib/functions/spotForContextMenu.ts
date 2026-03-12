export function sportForContextMenu(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return { x: 0, y: 0 }
  const elementCenterX = rect.left + rect.width / 2
  const elementCenterY = rect.top + rect.height / 2
  return { x: elementCenterX, y: elementCenterY }
}
