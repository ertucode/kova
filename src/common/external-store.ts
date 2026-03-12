export class ExternalStore<T = void> {
  private listeners: Set<(value: T) => void> = new Set();

  addListener = (listener: (value: T) => void) => {
    this.listeners.add(listener);

    return this.removeListener.bind(this, listener);
  };

  addOneTimeListener = (listener: (value: T) => void) => {
    const l = (value: T) => {
      listener(value);
      this.removeListener(l);
    };

    this.addListener(l);
  };

  removeListener = (listener: (value: T) => void) => {
    this.listeners.delete(listener);
  };

  notifyListeners = (value: T) => {
    this.listeners.forEach((l) => l(value));
  };
}
