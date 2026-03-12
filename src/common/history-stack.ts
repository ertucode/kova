export class HistoryStack<T> {
  private items: T[] = []
  private index: number = -1

  constructor(initialItems: T[]) {
    this.items = initialItems
    this.index = initialItems.length - 1
  }

  get hasPrev(): boolean {
    return this.index >= 0
  }

  get hasNext(): boolean {
    return this.index < this.items.length - 1
  }

  goNew(item: T): void {
    if (this.index < this.items.length - 1) {
      this.items = this.items.slice(0, this.index + 1)
    }

    this.items.push(item)
    this.index = this.items.length - 1
  }

  withNew(item: T) {
    this.goNew(item)
    return this
  }

  goPrev(): T {
    if (this.index < 0) {
      throw new Error('No previous item')
    }
    const item = this.items[this.index]
    this.index--
    return item
  }

  goPrevSafe(): T | undefined {
    if (this.index < 0) {
      return undefined
    }
    const item = this.items[this.index]
    this.index--
    return item
  }

  goNext(): T {
    if (!this.hasNext) {
      throw new Error('No next item')
    }
    this.index++
    return this.items[this.index]
  }

  goNextSafe(): T | undefined {
    if (!this.hasNext) {
      return undefined
    }
    this.index++
    return this.items[this.index]
  }

  goLatest() {
    this.index = this.items.length - 1
    return this
  }

  cleanUp(fn: (item: T) => boolean) {
    this.items = this.items.filter(fn)
    this.index = Math.min(this.index, this.items.length - 1)
    return this
  }

  hasItems(): boolean {
    return this.items.length > 0
  }

  current(): T | undefined {
    return this.items[this.index]
  }

  debug() {
    return `${JSON.stringify(this.items)}|${this.index}`
  }
}
