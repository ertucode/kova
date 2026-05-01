import type { TagRecord } from '@common/Tags'

export function TagDots({ tags, max = 4 }: { tags: TagRecord[]; max?: number }) {
  if (tags.length === 0) {
    return null
  }

  const visibleTags = tags.slice(0, max)
  const hiddenCount = tags.length - visibleTags.length

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {visibleTags.map(tag => (
        <span
          key={tag.id}
          className="size-2.5 rounded-full shadow-sm"
          style={{ backgroundColor: tag.color ?? 'color-mix(in oklch, var(--color-base-content) 28%, transparent)' }}
          title={tag.name}
          aria-label={tag.name}
        />
      ))}
      {hiddenCount > 0 ? <span className="text-[10px] text-base-content/45">+{hiddenCount}</span> : null}
    </span>
  )
}
