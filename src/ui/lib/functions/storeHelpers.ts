import { Store } from '@xstate/store'
import { useSyncExternalStore } from 'react'

export function subscribeToStores<const Stores extends readonly AnyStore[]>(
  stores: Stores,
  selector: (contexts: ContextsOf<Stores>) => readonly any[],
  fn: (contexts: ContextsOf<Stores>, changedIndexes: number[]) => void,
  initialRun = true
) {
  let lastChecks: readonly any[] | undefined

  const getContexts = (): ContextsOf<Stores> => stores.map(s => s.getSnapshot().context) as ContextsOf<Stores>

  const notifyIfChanged = () => {
    const contexts = getContexts()
    const currentChecks = selector(contexts)

    const changedIndexes: number[] = []
    if (lastChecks === undefined) {
      lastChecks = currentChecks
      for (let i = 0; i < currentChecks.length; i++) {
        changedIndexes.push(i)
      }
    } else {
      for (let i = 0; i < currentChecks.length; i++) {
        if (lastChecks && lastChecks[i] !== currentChecks[i]) {
          changedIndexes.push(i)
        }
      }
    }

    if (lastChecks?.length === currentChecks.length && changedIndexes.length === 0) return

    lastChecks = currentChecks
    fn(contexts, changedIndexes)
  }

  if (initialRun) notifyIfChanged()

  const unsubscribers = stores.map(store =>
    store.subscribe(() => {
      notifyIfChanged()
    })
  )

  return () => {
    unsubscribers.forEach(unsub => unsub.unsubscribe())
  }
}

type AnyStore = Store<any, any, any>

type StoreContext<S> = S extends Store<infer TContext, any, any> ? TContext : never

type ContextsOf<Stores extends readonly AnyStore[]> = {
  [K in keyof Stores]: StoreContext<Stores[K]>
}

export function createUseDerivedStoreValue<const Stores extends readonly AnyStore[], TDerivedValue>(
  stores: Stores,
  selector: (contexts: ContextsOf<Stores>) => readonly any[],
  fn: (contexts: ContextsOf<Stores>) => TDerivedValue
) {
  let lastValue: TDerivedValue | undefined

  const subscriptions = new Set<() => void>()

  const unsubscribe = subscribeToStores(
    stores,
    selector,
    contexts => {
      lastValue = fn(contexts)
      subscriptions.forEach(fn => fn())
    },
    false
  )

  const subscribe = (onStoreChange: () => void) => {
    // Subscribe to all stores
    subscriptions.add(onStoreChange)

    // Return cleanup function
    return () => {
      subscriptions.delete(onStoreChange)
    }
  }

  const getSnapshot = () => {
    return lastValue!
  }

  return [
    function useDerivedStoreValue(): TDerivedValue {
      // Use useSyncExternalStore for manual subscription that only rerenders when
      // the selector check values actually change, not when unrelated store parts change.

      return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    },
    () => lastValue,
    unsubscribe,
  ] as const
}
