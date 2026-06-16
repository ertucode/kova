import { useEffect, useState } from 'react'
import { errorResponseToMessage } from '@common/GenericError'
import type { ListOpenCodeModelsResponse } from '@common/ScriptAi'
import { getWindowElectron } from '@/getWindowElectron'

let cachedModels: ListOpenCodeModelsResponse | null = null
let pendingModelsPromise: Promise<ListOpenCodeModelsResponse> | null = null

export function useOpenCodeModels() {
  const [modelsState, setModelsState] = useState<ListOpenCodeModelsResponse | null>(cachedModels)
  const [loading, setLoading] = useState(cachedModels === null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedModels !== null) {
      setModelsState(cachedModels)
      setLoading(false)
      return
    }

    setLoading(true)
    void loadOpenCodeModels()
      .then(nextModelsState => {
        setModelsState(nextModelsState)
        setError(null)
      })
      .catch(nextError => {
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  return {
    models: modelsState?.models.map(model => model.id) ?? [],
    modelInfoById: Object.fromEntries((modelsState?.models ?? []).map(model => [model.id, model] as const)),
    loading,
    error,
  }
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

        cachedModels = result.data
        return cachedModels
      })
      .finally(() => {
        pendingModelsPromise = null
      })
  }

  return await pendingModelsPromise
}
