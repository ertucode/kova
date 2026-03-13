import { loadFromAsyncStorage, saveToAsyncStorage } from '@/utils/asyncStorage'
import { AsyncStorageKey } from '@common/AsyncStorageKeys'
import { useCallback, useState } from 'react'
import { ZodType } from 'zod'

export function useAsyncStorage<T>(
  key: AsyncStorageKey,
  schema: ZodType<T>,
  initialValue: NoInfer<T>,
  overrideValue?: $Maybe<NoInfer<T>>
) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (overrideValue) return overrideValue
    try {
      return loadFromAsyncStorage(key, schema, initialValue)
    } catch (error) {
      console.error(error)
      return initialValue
    }
  })

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue(storedValue => {
        try {
          const valueToStore = value instanceof Function ? value(storedValue) : value
          saveToAsyncStorage(key, schema, valueToStore)
          return valueToStore
        } catch (error) {
          console.error(error)
          return storedValue
        }
      })
    },
    [key, schema]
  )

  return [storedValue, setValue] as const
}
