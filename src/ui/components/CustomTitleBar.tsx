import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ChevronDownIcon, PinIcon, PinOffIcon, Minimize2Icon, Maximize2Icon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { windowStore, WindowStoreHelpers } from '@/global/windowStore'
import { environmentEditorStore } from '@/folders/environmentEditorStore'
import { EnvironmentCoordinator } from '@/folders/environmentCoordinator'
import { folderExplorerEditorStore } from '@/folders/folderExplorerEditorStore'

export function CustomTitleBar() {
  const state = useSelector(windowStore, s => s.context)
  const alwaysOnTop = state.alwaysOnTop
  const isCompact = state.isCompactWindowSize
  const environments = useSelector(environmentEditorStore, state => state.context.items)
  const activeEnvironmentIds = useSelector(folderExplorerEditorStore, state => state.context.activeEnvironmentIds)
  const [isEnvMenuOpen, setIsEnvMenuOpen] = useState(false)
  const envMenuRef = useRef<HTMLDivElement>(null)

  const activeEnvironmentNames = environments
    .filter(environment => activeEnvironmentIds.includes(environment.id))
    .map(environment => environment.name)

  useEffect(() => {
    if (!isEnvMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!envMenuRef.current?.contains(event.target as Node)) {
        setIsEnvMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isEnvMenuOpen])

  return (
    <div
      className="flex items-center w-full h-12 border-b border-base-content/10"
      style={
        {
          WebkitAppRegion: 'drag',
          WebkitUserSelect: 'none',
        } as React.CSSProperties
      }
    >
      {/* Space for macOS traffic lights */}
      <div className="w-20 flex-shrink-0" />

      {/* Navigation buttons */}
      <div
        className="flex items-center gap-2"
        style={
          {
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        {/* <NavigationButtons /> */}
      </div>

      <div className="flex-1 px-4">
        <div
          className="flex justify-center"
          style={
            {
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties
          }
        >
          <div ref={envMenuRef} className="relative">
            <button
              type="button"
              className="flex items-center gap-2 rounded-full border border-base-content/10 bg-base-100 px-3 py-1.5 text-xs text-base-content/70 transition hover:border-base-content/20 hover:bg-base-200 hover:text-base-content"
              onClick={() => setIsEnvMenuOpen(open => !open)}
              title="Toggle active environments"
            >
              <span className="max-w-[420px] truncate">
                {activeEnvironmentNames.length > 0 ? activeEnvironmentNames.join(', ') : 'No Active Envs'}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0" />
            </button>

            {isEnvMenuOpen ? (
              <div className="absolute left-1/2 top-[calc(100%+8px)] z-50 w-[280px] -translate-x-1/2 overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 shadow-2xl">
                <div className="border-b border-base-content/10 px-3 py-2 text-sm font-medium text-base-content/60">
                  Environments
                </div>

                <div className="max-h-72 overflow-auto p-2">
                  {environments.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-base-content/45">No environments available</div>
                  ) : (
                    <div className="space-y-1">
                      {environments.map(environment => {
                        const isActive = activeEnvironmentIds.includes(environment.id)

                        return (
                          <button
                            key={environment.id}
                            type="button"
                            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-base-200"
                            onClick={() => EnvironmentCoordinator.toggleActiveEnvironment(environment.id)}
                          >
                            <div
                              className={[
                                'flex size-4 shrink-0 items-center justify-center rounded border',
                                isActive ? 'border-success/30 bg-success/15 text-success' : 'border-base-content/12 text-transparent',
                              ].join(' ')}
                            >
                              <CheckIcon className="size-3" />
                            </div>
                            <span className="min-w-0 flex-1 truncate text-base-content">{environment.name}</span>
                            <span className="text-xs text-base-content/40">{environment.priority}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Window controls */}
      <div
        className="flex items-center gap-2 pr-4"
        style={
          {
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        {/* Compact window size toggle */}
        <button
          className={`btn btn-xs ${isCompact ? 'btn-info' : 'btn-soft btn-info'}`}
          onClick={WindowStoreHelpers.toggleWindowSize}
          title={isCompact ? 'Restore window size' : 'Set compact size (1/3 screen)'}
        >
          {isCompact ? <Maximize2Icon className="size-4" /> : <Minimize2Icon className="size-4" />}
        </button>

        {/* Always on top button */}
        <button
          className={`btn btn-xs ${alwaysOnTop ? 'btn-info' : 'btn-soft btn-info'}`}
          onClick={WindowStoreHelpers.toggleAlwaysOnTop}
          title={
            alwaysOnTop
              ? 'Disable always on top (⌘+click to also resize)'
              : 'Enable always on top (⌘+click to also resize)'
          }
        >
          {alwaysOnTop ? <PinIcon className="size-4" /> : <PinOffIcon className="size-4" />}
        </button>
      </div>
    </div>
  )
}
