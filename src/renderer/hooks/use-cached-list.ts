import { useEffect, useState } from 'react'

export interface ListCache<T> {
  value: T[] | null
  seq: number
}

export function createListCache<T>(): ListCache<T> {
  return { value: null, seq: 0 }
}

export function useCachedList<T>(cache: ListCache<T>, fetchList: () => Promise<T[]>): T[] | null {
  const [value, setValue] = useState<T[] | null>(cache.value)

  useEffect(() => {
    let cancelled = false
    const seq = ++cache.seq
    fetchList()
      .then((result) => {
        if (seq === cache.seq) cache.value = result
        if (!cancelled) setValue(result)
      })
      .catch(() => {
        if (!cancelled) setValue((prev) => prev ?? [])
      })
    return () => {
      cancelled = true
    }
  }, [cache, fetchList])

  return value
}
