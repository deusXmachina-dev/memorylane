export class PositionalAliases {
  private readonly realOf = new Map<string, string>()
  private readonly shortOf = new Map<string, string>()

  constructor(private readonly prefix: string) {}

  encode(realId: string): string {
    const existing = this.shortOf.get(realId)
    if (existing) return existing
    const short = `${this.prefix}${this.realOf.size + 1}`
    this.shortOf.set(realId, short)
    this.realOf.set(short, realId)
    return short
  }

  decode(short: unknown): string | undefined {
    if (typeof short !== 'string') return undefined
    return this.realOf.get(short.trim())
  }

  decodeMany(shorts: unknown): { ids: string[]; unmapped: number } {
    if (!Array.isArray(shorts)) return { ids: [], unmapped: 1 }
    const ids = shorts
      .map((short) => this.decode(short))
      .filter((id): id is string => id !== undefined)
    return { ids, unmapped: shorts.length - ids.length }
  }
}
