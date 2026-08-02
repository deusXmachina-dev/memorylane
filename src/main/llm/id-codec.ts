export class PositionalAliases {
  private readonly realOf = new Map<string, string>()
  private readonly shortOf = new Map<string, string>()
  private counter = 0

  constructor(private readonly prefix: string) {}

  encode(realId: string): string {
    const existing = this.shortOf.get(realId)
    if (existing) return existing
    const short = `${this.prefix}${++this.counter}`
    this.shortOf.set(realId, short)
    this.realOf.set(short, realId)
    return short
  }

  decode(short: unknown): string | undefined {
    if (typeof short !== 'string') return undefined
    return this.realOf.get(short.trim())
  }

  /** null = not a list of handles at all, which is not the same as a list none of whose handles resolved. */
  decodeMany(shorts: unknown): { ids: string[]; unmapped: number } | null {
    if (!Array.isArray(shorts)) return null
    const ids = shorts
      .map((short) => this.decode(short))
      .filter((id): id is string => id !== undefined)
    return { ids, unmapped: shorts.length - ids.length }
  }
}
