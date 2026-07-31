const HANDLE_SUFFIX = /^\d+$/

export class PositionalAliases {
  private readonly realOf = new Map<string, string>()
  private readonly shortOf = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  encode(prefix: string, realId: string): string {
    const key = `${prefix} ${realId}`
    const existing = this.shortOf.get(key)
    if (existing) return existing
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    const short = `${prefix}${next}`
    this.shortOf.set(key, short)
    this.realOf.set(short, realId)
    return short
  }

  decode(prefix: string, short: unknown): string | undefined {
    if (typeof short !== 'string') return undefined
    const trimmed = short.trim()
    if (!trimmed.startsWith(prefix)) return undefined
    if (!HANDLE_SUFFIX.test(trimmed.slice(prefix.length))) return undefined
    return this.realOf.get(trimmed)
  }

  decodeMany(
    prefix: string,
    shorts: readonly unknown[] | undefined,
  ): { ids: string[]; unmapped: number } {
    if (!Array.isArray(shorts)) return { ids: [], unmapped: 1 }
    const ids = shorts
      .map((short) => this.decode(prefix, short))
      .filter((id): id is string => id !== undefined)
    return { ids, unmapped: shorts.length - ids.length }
  }
}
