import { useEffect, useState } from 'react'
import type { ScriptPackageArtifact, ScriptPackageListItem } from '@common/ScriptPackages'
import { getWindowElectron } from '@/getWindowElectron'

const SCRIPT_PACKAGES_CHANGED_EVENT = 'kova-script-packages-changed'

export function notifyScriptPackagesChanged() {
  window.dispatchEvent(new Event(SCRIPT_PACKAGES_CHANGED_EVENT))
}

export function useScriptPackages() {
  const [items, setItems] = useState<ScriptPackageListItem[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    try {
      setItems(await getWindowElectron().listScriptPackages())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const onChange = () => {
      void reload()
    }

    window.addEventListener(SCRIPT_PACKAGES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SCRIPT_PACKAGES_CHANGED_EVENT, onChange)
  }, [])

  return { items, loading, reload }
}

export function useScriptPackageArtifacts() {
  const [artifacts, setArtifacts] = useState<ScriptPackageArtifact[]>([])
  const [loading, setLoading] = useState(true)

  async function reload() {
    setLoading(true)
    try {
      setArtifacts(await getWindowElectron().getScriptPackageArtifacts())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const onChange = () => {
      void reload()
    }

    window.addEventListener(SCRIPT_PACKAGES_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SCRIPT_PACKAGES_CHANGED_EVENT, onChange)
  }, [])

  return { artifacts, loading, reload }
}
