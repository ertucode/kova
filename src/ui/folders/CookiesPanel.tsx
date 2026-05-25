import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import type { CookieSameSite } from '@common/Cookies'
import { AppSettingsCoordinator, appSettingsStore } from '@/global/appSettingsStore'
import { CookiesCoordinator } from './cookiesCoordinator'
import { cookiesStore, isCookieEntryDirty } from './cookiesStore'

const SAME_SITE_OPTIONS: Array<{ value: CookieSameSite | null; label: string }> = [
  { value: null, label: 'Unset' },
  { value: 'lax', label: 'Lax' },
  { value: 'strict', label: 'Strict' },
  { value: 'none', label: 'None' },
]

export function CookiesPanel() {
  const items = useSelector(cookiesStore, state => state.context.items)
  const entries = useSelector(cookiesStore, state => state.context.entries)
  const focusCookieId = useSelector(cookiesStore, state => state.context.focusCookieId)
  const loading = useSelector(cookiesStore, state => state.context.loading)
  const cookiesEnabled = useSelector(appSettingsStore, state => state.context.settings?.cookiesEnabled ?? true)
  const settingsSaving = useSelector(appSettingsStore, state => state.context.saving)
  const settings = useSelector(appSettingsStore, state => state.context.settings)
  const [searchValue, setSearchValue] = useState('')
  const nameInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    void CookiesCoordinator.loadCookies()
    void AppSettingsCoordinator.loadSettings()
  }, [])

  useEffect(() => {
    if (!focusCookieId) {
      return
    }

    nameInputRefs.current[focusCookieId]?.focus()
    nameInputRefs.current[focusCookieId]?.select()
    cookiesStore.trigger.focusHandled()
  }, [focusCookieId, items.length])

  const visibleItems = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase()
    if (!normalizedQuery) {
      return items
    }

    return items.filter(item =>
      [item.name, item.domain, item.path, item.value].some(value => value.toLowerCase().includes(normalizedQuery))
    )
  }, [items, searchValue])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[color:color-mix(in_oklch,var(--color-base-100)_92%,black)]">
      <div className="border-b border-base-content/10 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-base-content">Cookies</div>
            <label className="flex items-center gap-2 border border-base-content/10 bg-base-100 px-3 py-2 text-sm text-base-content">
              <input
                type="checkbox"
                checked={cookiesEnabled}
                disabled={!settings || settingsSaving}
                onChange={event => {
                  void AppSettingsCoordinator.saveSettings({ cookiesEnabled: event.target.checked })
                }}
                className="checkbox checkbox-primary checkbox-sm"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 text-base-content transition hover:border-error/25 hover:bg-error/8 hover:text-error disabled:opacity-50"
              onClick={() => CookiesCoordinator.requestClearCookies()}
              disabled={items.length === 0}
              aria-label="Clear cookies"
              title="Clear cookies"
            >
              <Trash2Icon className="size-4" />
            </button>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-base-content/10 bg-base-100 text-base-content transition hover:border-base-content/20 hover:bg-base-200"
              onClick={() => void CookiesCoordinator.createCookie()}
              aria-label="Add cookie"
              title="Add cookie"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-3 border border-base-content/10 bg-base-100 px-3 py-2.5">
          <input
            value={searchValue}
            onChange={event => setSearchValue(event.target.value)}
            placeholder="Filter by name, domain, path, or value"
            className="w-full border-0 bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/35"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? <div className="px-4 py-4 text-sm text-base-content/45">Loading cookies...</div> : null}
        {!loading && visibleItems.length === 0 ? (
          <div className="px-4 py-4 text-sm text-base-content/45">
            {items.length === 0 ? 'No cookies stored yet.' : 'No cookies match your search.'}
          </div>
        ) : null}

        {visibleItems.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table table-zebra table-pin-rows min-w-[1640px] text-[12px] [&_td]:p-0 [&_td]:align-middle [&_th]:p-2 [&_th]:align-middle [&_th]:text-center ">
              <thead className="bg-base-100 text-[11px] font-medium text-base-content/55">
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Domain</th>
                  <th>Path</th>
                  <th>Expires</th>
                  <th>SameSite</th>
                  <th>Secure</th>
                  <th>HttpOnly</th>
                  <th>HostOnly</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th className="w-[140px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(item => {
                  const entry = entries[item.id]
                  const draft = entry?.current
                  if (!draft) {
                    return null
                  }

                  const isDirty = isCookieEntryDirty(entry)
                  const isSaving = Boolean(entry?.saving)

                  return (
                    <tr key={item.id} className="align-top">
                      <td>
                        <input
                          ref={element => {
                            nameInputRefs.current[item.id] = element
                          }}
                          value={draft.name}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, { ...draft, name: event.target.value })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[160px] border-0 bg-base-100 px-2 py-1.5 text-[12px] text-base-content outline-none"
                          placeholder="name"
                        />
                      </td>
                      <td>
                        <input
                          value={draft.value}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, { ...draft, value: event.target.value })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[220px] border-0 bg-base-100 px-2 py-1.5 font-mono text-[11px] text-base-content outline-none"
                          placeholder="value"
                        />
                      </td>
                      <td>
                        <input
                          value={draft.domain}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, { ...draft, domain: event.target.value })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[190px] border-0 bg-base-100 px-2 py-1.5 text-[12px] text-base-content outline-none"
                          placeholder="example.com"
                        />
                      </td>
                      <td>
                        <input
                          value={draft.path}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, { ...draft, path: event.target.value })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[120px] border-0 bg-base-100 px-2 py-1.5 font-mono text-[11px] text-base-content outline-none"
                          placeholder="/"
                        />
                      </td>
                      <td>
                        <input
                          type="datetime-local"
                          value={formatDateTimeLocalValue(draft.expiresAt)}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, {
                              ...draft,
                              expiresAt: event.target.value ? new Date(event.target.value).getTime() : null,
                            })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[180px] border-0 bg-base-100 px-2 py-1.5 text-[12px] text-base-content outline-none"
                        />
                      </td>
                      <td>
                        <select
                          value={draft.sameSite ?? ''}
                          onChange={event =>
                            CookiesCoordinator.updateDraft(item.id, {
                              ...draft,
                              sameSite: (event.target.value || null) as CookieSameSite | null,
                            })
                          }
                          className="block h-full min-h-[40px] w-full min-w-[110px] border-0 bg-base-100 px-2 py-1.5 text-[12px] text-base-content outline-none"
                        >
                          {SAME_SITE_OPTIONS.map(option => (
                            <option key={option.value ?? 'unset'} value={option.value ?? ''}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="flex h-full min-h-[42px] items-center justify-center">
                          <input
                            type="checkbox"
                            checked={draft.secure}
                            onChange={event =>
                              CookiesCoordinator.updateDraft(item.id, { ...draft, secure: event.target.checked })
                            }
                            className="checkbox checkbox-primary checkbox-sm"
                          />
                        </div>
                      </td>
                      <td>
                        <div className="flex h-full min-h-[42px] items-center justify-center">
                          <input
                            type="checkbox"
                            checked={draft.httpOnly}
                            onChange={event =>
                              CookiesCoordinator.updateDraft(item.id, { ...draft, httpOnly: event.target.checked })
                            }
                            className="checkbox checkbox-primary checkbox-sm"
                          />
                        </div>
                      </td>
                      <td>
                        <div className="flex h-full min-h-[42px] items-center justify-center">
                          <input
                            type="checkbox"
                            checked={draft.hostOnly}
                            onChange={event =>
                              CookiesCoordinator.updateDraft(item.id, { ...draft, hostOnly: event.target.checked })
                            }
                            className="checkbox checkbox-primary checkbox-sm"
                          />
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs text-base-content/55">
                        {formatDateTimeCell(item.createdAt)}
                      </td>
                      <td className="whitespace-nowrap text-xs text-base-content/55">
                        {formatDateTimeCell(item.updatedAt)}
                      </td>
                      <td>
                        <div className="flex items-center justify-center gap-2 w-full">
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center border border-base-content/10 bg-base-100 text-base-content transition hover:border-base-content/20 hover:bg-base-200 disabled:opacity-50"
                            onClick={() => void CookiesCoordinator.saveCookie(item.id)}
                            disabled={!isDirty || isSaving}
                            aria-label="Save cookie"
                            title={entry?.error ? entry.error : isSaving ? 'Saving...' : 'Save cookie'}
                          >
                            <SaveIcon className="size-4" />
                          </button>
                          <button
                            type="button"
                            className="-ml-px flex h-9 w-9 items-center justify-center border border-base-content/10 bg-base-100 text-base-content transition hover:border-error/25 hover:bg-error/8 hover:text-error"
                            onClick={() =>
                              CookiesCoordinator.requestDeleteCookie(item.id, draft.name || 'Untitled cookie')
                            }
                            aria-label="Delete cookie"
                            title="Delete cookie"
                          >
                            <Trash2Icon className="size-4" />
                          </button>
                        </div>
                        {entry?.error ? (
                          <div className="mt-2 max-w-[120px] text-xs text-error">{entry.error}</div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatDateTimeCell(value: number | null) {
  if (value === null) {
    return '-'
  }

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function formatDateTimeLocalValue(value: number | null) {
  if (value === null) {
    return ''
  }

  const date = new Date(value)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}
