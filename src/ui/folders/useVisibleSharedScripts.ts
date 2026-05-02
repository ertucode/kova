import { useEffect, useState } from 'react'
import type { SharedScriptRecord, SharedScriptScopeType } from '@common/SharedScripts'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

export const SHARED_SCRIPTS_CHANGED_EVENT = 'kova:shared-scripts-changed'

export function notifySharedScriptsChanged() {
  window.dispatchEvent(new Event(SHARED_SCRIPTS_CHANGED_EVENT))
}

export function useVisibleSharedScripts(folderId: string | null) {
  const [scripts, setScripts] = useState<SharedScriptRecord[]>([])

  const load = async () => {
    try {
      const items = await getWindowElectron().listVisibleSharedScripts({ folderId })
      setScripts(items)
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load shared scripts',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  useEffect(() => {
    let cancelled = false

    void getWindowElectron()
      .listVisibleSharedScripts({ folderId })
      .then(items => {
        if (!cancelled) {
          setScripts(items)
        }
      })
      .catch(error => {
        if (cancelled) {
          return
        }

        toast.show({
          severity: 'error',
          title: 'Failed to load shared scripts',
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [folderId])

  useEffect(() => {
    const handleChanged = () => {
      void load()
    }

    window.addEventListener(SHARED_SCRIPTS_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(SHARED_SCRIPTS_CHANGED_EVENT, handleChanged)
  }, [folderId])

  return { scripts, reload: load }
}

export function useScopedSharedScripts(scopeType: SharedScriptScopeType, scopeId: string | null) {
  const [scripts, setScripts] = useState<SharedScriptRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)

  const load = async () => {
    setLoading(true)

    try {
      const items = await getWindowElectron().listSharedScripts({ scopeType, scopeId })
      setScripts(items)
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load shared scripts',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setHasLoaded(true)
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [scopeId, scopeType])

  useEffect(() => {
    const handleChanged = () => {
      void load()
    }

    window.addEventListener(SHARED_SCRIPTS_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(SHARED_SCRIPTS_CHANGED_EVENT, handleChanged)
  }, [scopeId, scopeType])

  return { scripts, setScripts, loading, hasLoaded, reload: load }
}
