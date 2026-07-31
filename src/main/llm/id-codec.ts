/**
 * Short handles for the opaque ids we put in front of a model. Models mangle
 * long UUIDs when citing them back — dropping whole findings — and each one
 * costs 15-20 tokens against 2-3 for a handle.
 */
export interface IdCodec {
  encode(realId: string): string
  decode(short: string): string | undefined
}

/**
 * Request-scoped handles: `a1`, `c2`, `s37`. Numbering runs per prefix and
 * handles are minted on first encode, so a payload can carry several id kinds
 * and a caller can hand back an id the original snapshot never contained.
 *
 * Only usable where one payload's response comes back before the table is
 * discarded. A surface whose ids outlive the call (MCP) needs a stateless
 * IdCodec instead.
 */
export class PositionalAliases {
  private readonly realOf = new Map<string, string>()
  private readonly shortOf = new Map<string, string>()
  private readonly counters = new Map<string, number>()

  encode(prefix: string, realId: string): string {
    const existing = this.shortOf.get(realId)
    if (existing) return existing
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    const short = `${prefix}${next}`
    this.shortOf.set(realId, short)
    this.realOf.set(short, realId)
    return short
  }

  decode(short: string): string | undefined {
    return this.realOf.get(short.trim())
  }

  decodeMany(shorts: readonly string[]): { ids: string[]; unmapped: number } {
    const ids = shorts.map((s) => this.decode(s)).filter((id): id is string => id !== undefined)
    return { ids, unmapped: shorts.length - ids.length }
  }

  /** A view bound to one prefix, for callers that deal in a single id kind. */
  namespace(prefix: string): IdCodec {
    return {
      encode: (realId) => this.encode(prefix, realId),
      decode: (short) => this.decode(short),
    }
  }
}
