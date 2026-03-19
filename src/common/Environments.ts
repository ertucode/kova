export type EnvironmentRecord = {
  id: string
  name: string
  variables: string
  color: string | null
  position: number
  priority: number
  createdAt: number
  deletedAt: number | null
}

export type CreateEnvironmentInput = {
  name: string
}

export type UpdateEnvironmentInput = {
  id: string
  name: string
  variables: string
  color: string | null
  priority: number
}

export type DeleteEnvironmentInput = {
  id: string
}

export type DuplicateEnvironmentInput = {
  id: string
}

export type MoveEnvironmentInput = {
  id: string
  targetPosition: number
}

const namedEnvironmentColors: Record<string, string> = {
  blue: '#3b82f6',
  cyan: '#06b6d4',
  green: '#22c55e',
  orange: '#f97316',
  pink: '#ec4899',
  purple: '#a855f7',
  red: '#ef4444',
  yellow: '#eab308',
}

export function normalizeEnvironmentColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  const lowerCased = trimmed.toLowerCase()
  const namedColor = namedEnvironmentColors[lowerCased]
  if (namedColor) {
    return namedColor
  }

  const shortHexMatch = /^#([\da-f]{3})$/iu.exec(trimmed)
  if (shortHexMatch) {
    const [red, green, blue] = shortHexMatch[1]
    return `#${red}${red}${green}${green}${blue}${blue}`.toLowerCase()
  }

  const longHexMatch = /^#([\da-f]{6})$/iu.exec(trimmed)
  if (longHexMatch) {
    return `#${longHexMatch[1].toLowerCase()}`
  }

  return null
}

export function hexColorToRgba(color: string, alpha: number): string {
  const normalized = normalizeEnvironmentColor(color)
  if (!normalized) {
    return `rgba(0, 0, 0, ${alpha})`
  }

  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
