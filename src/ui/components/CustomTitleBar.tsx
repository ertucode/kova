import { PinIcon, PinOffIcon, Minimize2Icon, Maximize2Icon } from 'lucide-react'
import { useSelector } from '@xstate/store/react'
import { windowStore, WindowStoreHelpers } from '@/global/windowStore'

export function CustomTitleBar() {
  const state = useSelector(windowStore, s => s.context)
  const alwaysOnTop = state.alwaysOnTop
  const isCompact = state.isCompactWindowSize

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

      {/* Spacer */}
      <div className="flex-1" />

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
