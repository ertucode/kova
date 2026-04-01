import { useEffect, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES } from '@common/AppSettings'
import { Dialog } from '@/lib/components/dialog'
import { dialogActions } from './dialogStore'
import { AppSettingsCoordinator, appSettingsStore } from './appSettingsStore'

export function AppSettingsDialog() {
  const settings = useSelector(appSettingsStore, state => state.context.settings)
  const saving = useSelector(appSettingsStore, state => state.context.saving)
  const [warnBeforeRequestAfterSeconds, setWarnBeforeRequestAfterSeconds] = useState('10')
  const [responseBodyDisplayMode, setResponseBodyDisplayMode] = useState<(typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number]>('raw')

  useEffect(() => {
    if (settings) {
      setWarnBeforeRequestAfterSeconds(String(settings.warnBeforeRequestAfterSeconds))
      setResponseBodyDisplayMode(settings.responseBodyDisplayMode)
    }
  }, [settings])

  const handleSave = async () => {
    const value = Number(warnBeforeRequestAfterSeconds)
    const nextValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : Number.NaN
    if (!Number.isFinite(nextValue)) {
      return
    }

    const success = await AppSettingsCoordinator.saveSettings({
      warnBeforeRequestAfterSeconds: nextValue,
      responseBodyDisplayMode,
    })

    if (success) {
      dialogActions.close()
    }
  }

  return (
    <Dialog
      title="Settings"
      onClose={() => dialogActions.close()}
      className="max-w-[560px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 p-4">
          <div className="text-sm font-medium text-base-content">Warn before request</div>
          <p className="mt-1 text-sm text-base-content/60">
            When an active environment has request warnings enabled, show a confirmation dialog if the last request is older than this threshold.
          </p>

          <label className="mt-4 block max-w-[220px]">
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.16em] text-base-content/45">Seconds</div>
            <input
              type="number"
              min={0}
              step={1}
              className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
              value={warnBeforeRequestAfterSeconds}
              onChange={event => setWarnBeforeRequestAfterSeconds(event.target.value)}
            />
          </label>
        </div>

        <div className="rounded-2xl border border-base-content/10 bg-base-200/35 p-4">
          <div className="text-sm font-medium text-base-content">Response body display</div>
          <p className="mt-1 text-sm text-base-content/60">
            Choose whether the Raw response view should default to the original payload or a formatted preview when formatting is available.
          </p>

          <div className="mt-4 inline-flex overflow-hidden rounded-xl border border-base-content/10 bg-base-100/80">
            {APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.map(mode => (
              <button
                key={mode}
                type="button"
                className={[
                  'px-4 py-2 text-sm font-medium capitalize transition',
                  mode === responseBodyDisplayMode
                    ? 'bg-base-200 text-base-content'
                    : 'border-l border-base-content/10 text-base-content/60 first:border-l-0 hover:text-base-content',
                ].join(' ')}
                onClick={() => setResponseBodyDisplayMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
