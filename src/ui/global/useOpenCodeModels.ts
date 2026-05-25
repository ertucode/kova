import { useEffect, useState } from 'react'
import { errorResponseToMessage } from '@common/GenericError'
import { getWindowElectron } from '@/getWindowElectron'

let cachedModels: string[] | null = null
let pendingModelsPromise: Promise<string[]> | null = null

export function useOpenCodeModels() {
  const [models, setModels] = useState<string[]>(cachedModels ?? [])
  const [loading, setLoading] = useState(cachedModels === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedModels !== null) {
      setModels(cachedModels)
      setLoading(false)
      return
    }

    setLoading(true)
    void loadOpenCodeModels()
      .then(nextModels => {
        setModels(nextModels)
        setError(null)
      })
      .catch(nextError => {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  return { models, loading, error }
}

async function loadOpenCodeModels() {
  if (cachedModels !== null) {
    return cachedModels
  }

  if (!pendingModelsPromise) {
    pendingModelsPromise = getWindowElectron()
      .listOpenCodeModels()
      .then(result => {
        if (!result.success) {
          throw new Error(errorResponseToMessage(result.error))
        }

        cachedModels = result.data.models
        return cachedModels
      })
      .finally(() => {
        pendingModelsPromise = null
      })
  }

  return await pendingModelsPromise
}
