import { AsyncStorageKey } from '@common/AsyncStorageKeys'
import { debounce } from '@common/debounce'
import { z } from 'zod'

/**
 * Load data from asyncStorage with schema validation
 * @param key - key
 * @param schema - Zod schema for validation
 * @param defaultValue - Default value if loading fails
 * @returns Validated data or default value
 */
export const loadFromAsyncStorage = <T>(key: AsyncStorageKey, schema: z.ZodType<T>, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key)
    if (!item) return defaultValue
    const safeParsed = schema.safeParse(item) // string icin
    if (safeParsed.success) return safeParsed.data
    const parsed = JSON.parse(item)
    return schema.parse(parsed)
  } catch {
    return defaultValue
  }
}

/**
 * Save data to asyncStorage with schema validation
 * @param key - key
 * @param schema - Zod schema for validation
 * @param value - Value to save
 */
export const saveToAsyncStorage = async <T>(key: AsyncStorageKey, schema: z.ZodType<T>, value: T): Promise<void> => {
  try {
    const validated = schema.parse(value)
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(validated))
  } catch {
    // Ignore validation errors
  }
}

/**
 * Create a asyncStorage persistence helper for xstate stores
 * @param key - key
 * @param schema - Zod schema for validation
 * @returns Object with load and save functions
 */
export const createAsyncStoragePersistence = <T>(key: AsyncStorageKey, schema: z.ZodType<T>, debounceMs?: number) => ({
  load: (defaultValue: T) => loadFromAsyncStorage(key, schema, defaultValue),
  save: debounceMs
    ? debounce((value: T) => saveToAsyncStorage(key, schema, value), debounceMs)
    : (value: T) => saveToAsyncStorage(key, schema, value),
})
