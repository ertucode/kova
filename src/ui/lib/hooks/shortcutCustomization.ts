import { createStore } from '@xstate/store'
import { z } from 'zod'
import { ShortcutCode } from './useShortcuts'
import { AsyncStorageKeys } from '@common/AsyncStorageKeys'
import { createAsyncStoragePersistence } from '@/utils/asyncStorage'

// Schema for a single shortcut definition
const shortcutDefinitionSchema: z.ZodType<ShortcutCode> = z.union([
  z.string(),
  z.object({
    code: z.string(),
    metaKey: z.boolean().optional(),
    shiftKey: z.boolean().optional(),
    ctrlKey: z.boolean().optional(),
    altKey: z.boolean().optional(),
  }),
])

// Schema for custom shortcuts storage
const CustomShortcutsSchema = z.record(
  z.string(), // label
  z.union([
    shortcutDefinitionSchema,
    z.array(shortcutDefinitionSchema),
    z.object({
      sequence: z.array(z.string()),
    }),
  ])
)

export type CustomShortcuts = z.infer<typeof CustomShortcutsSchema>

const customShortcutsPersistence = createAsyncStoragePersistence(
  AsyncStorageKeys.customShortcuts,
  CustomShortcutsSchema
)

// Create the store
export const shortcutCustomizationStore = createStore({
  context: {
    customShortcuts: customShortcutsPersistence.load({}),
  },
  on: {
    setCustomShortcut: (
      context,
      event: {
        label: string
        shortcut: ShortcutCode | ShortcutCode[] | { sequence: string[] }
      }
    ) => ({
      ...context,
      customShortcuts: {
        ...context.customShortcuts,
        [event.label]: event.shortcut,
      },
    }),

    removeCustomShortcut: (context, event: { label: string }) => {
      const { [event.label]: _, ...rest } = context.customShortcuts
      return {
        ...context,
        customShortcuts: rest,
      }
    },

    resetAllShortcuts: context => ({
      ...context,
      customShortcuts: {},
    }),
  },
})

// Subscribe to store changes for persistence
shortcutCustomizationStore.subscribe(state => {
  customShortcutsPersistence.save(state.context.customShortcuts)
})

// Helper functions
export const shortcutCustomizationHelpers = {
  setCustomShortcut: (label: string, shortcut: ShortcutCode | ShortcutCode[] | { sequence: string[] }) =>
    shortcutCustomizationStore.send({
      type: 'setCustomShortcut',
      label,
      shortcut,
    }),

  removeCustomShortcut: (label: string) => shortcutCustomizationStore.send({ type: 'removeCustomShortcut', label }),

  resetAllShortcuts: () => shortcutCustomizationStore.send({ type: 'resetAllShortcuts' }),

  getCustomShortcut: (label: string) => {
    const state = shortcutCustomizationStore.get()
    return state.context.customShortcuts[label]
  },

  hasCustomShortcut: (label: string) => {
    const state = shortcutCustomizationStore.get()
    return label in state.context.customShortcuts
  },
}
