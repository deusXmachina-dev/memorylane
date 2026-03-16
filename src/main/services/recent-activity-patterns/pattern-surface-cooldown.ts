export class PatternSurfaceCooldown {
  private readonly lastSurfacedAtByPatternId = new Map<string, number>()
  private readonly cooldownMs: number

  constructor(cooldownMs = 4 * 60 * 60 * 1000) {
    if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
      throw new Error('cooldownMs must be > 0')
    }
    this.cooldownMs = cooldownMs
  }

  tryMarkSurfaced(patternId: string, now: number): boolean {
    const lastSurfacedAt = this.lastSurfacedAtByPatternId.get(patternId)
    if (lastSurfacedAt !== undefined && now - lastSurfacedAt < this.cooldownMs) {
      return false
    }

    this.lastSurfacedAtByPatternId.set(patternId, now)
    return true
  }
}
