import { useEffect, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'
import { tagsStore } from './tagsStore'

const OPEN_DELAY_MS = 500

export function TagShortcutGuide() {
  const sidebarTab = useSelector(folderExplorerEditorStore, state => state.context.sidebarTab)
  const tags = useSelector(tagsStore, state => state.context.items)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    let openTimeoutId: number | null = null

    const cancelPendingOpen = () => {
      if (openTimeoutId !== null) {
        window.clearTimeout(openTimeoutId)
        openTimeoutId = null
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        sidebarTab === 'requests' &&
        event.key === 'Alt' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        openTimeoutId === null
      ) {
        openTimeoutId = window.setTimeout(() => {
          openTimeoutId = null
          setIsOpen(true)
        }, OPEN_DELAY_MS)
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        cancelPendingOpen()
        setIsOpen(false)
      }
    }
    const handleBlur = () => {
      cancelPendingOpen()
      setIsOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      cancelPendingOpen()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [sidebarTab])

  useEffect(() => {
    if (sidebarTab !== 'requests') {
      setIsOpen(false)
    }
  }, [sidebarTab])

  if (!isOpen) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[1000] flex items-center justify-center bg-base-300/25 p-6 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-shortcut-guide-title"
        className="pointer-events-auto flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-base-content/10 bg-base-100 shadow-2xl"
      >
        <div className="border-b border-base-content/10 px-6 py-5">
          <h2 id="tag-shortcut-guide-title" className="text-lg font-semibold text-base-content">
            Tags
          </h2>
        </div>

        <div className="min-h-0 overflow-auto p-3">
          {tags.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-base-content/45">No tags yet.</p>
          ) : (
            <div className="space-y-1">
              {tags.map((tag, index) => (
                <div key={tag.id} className="flex items-center gap-3 rounded-2xl px-3 py-2.5 even:bg-base-200/45">
                  <kbd className="kbd kbd-sm w-14 shrink-0">⌥{index + 1}</kbd>
                  <span
                    className="size-3 shrink-0 rounded-full ring-1 ring-base-content/10 ring-offset-2 ring-offset-base-100"
                    style={{ backgroundColor: tag.color ?? 'color-mix(in oklch, var(--color-base-content) 28%, transparent)' }}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-base-content">{tag.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
