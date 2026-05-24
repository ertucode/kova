import { useEffect, useState } from 'react'
import type { ViewRecord } from '@common/Views'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

const VIEWS_CHANGED_EVENT = 'kova:views-changed'

export function notifyViewsChanged() {
  window.dispatchEvent(new Event(VIEWS_CHANGED_EVENT))
}

export function useViews() {
  const [items, setItems] = useState<ViewRecord[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    try {
      setItems(await getWindowElectron().listViews())
    } catch (error) {
      toast.show({
        severity: 'error',
        title: 'Failed to load views',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  useEffect(() => {
    const handleChanged = () => {
      void reload()
    }

    window.addEventListener(VIEWS_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(VIEWS_CHANGED_EVENT, handleChanged)
  }, [])

  return { items, loading, reload }
}
