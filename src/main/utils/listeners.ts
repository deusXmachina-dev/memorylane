export interface ListenerSet<T extends unknown[]> {
  add(listener: (...args: T) => void): () => void
  emit(...args: T): void
}

export function listenerSet<T extends unknown[] = []>(): ListenerSet<T> {
  const listeners = new Set<(...args: T) => void>()
  return {
    add(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(...args) {
      for (const listener of listeners) listener(...args)
    },
  }
}
