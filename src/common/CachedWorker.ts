export type WorkerCacheItem<TMapped> =
  | {
      loading: true
      promise: Promise<TMapped>
    }
  | {
      loading: false
      loaded: TMapped
    }

export class CachedWorker<TItem, TMapped> {
  private cache = new Map<string, WorkerCacheItem<TMapped>>()

  constructor(
    private work: (key: string) => Promise<TItem>,
    private mapper: (item: TItem, key: string) => TMapped,
    private staleTime: number = 4000
  ) {}

  load = async (key: string, forceReload = false) => {
    if (!forceReload) {
      const cached = this.cache.get(key)
      if (cached) {
        if (!cached.loading) return cached.loaded
        return cached.promise
      }
    }

    const promise = this.work(key).then(result => {
      const mapped = this.mapper(result, key)
      this.cache.set(key, { loading: false, loaded: mapped })

      setTimeout(() => {
        this.cache.delete(key)
      }, this.staleTime)
      return result
    })
    return promise
  }
}
