import log from '@main/utils/logger'

export interface PeriodicJobParams {
  name: string
  intervalMs: number
  run: (reason: string, force: boolean) => Promise<void>
}

/**
 * Runs `run` on startup, on a timer, and on demand. A request that lands while
 * a run is in flight queues one rerun (forced if any queued request was), and
 * `stop()` waits for the in-flight run.
 */
export class PeriodicJob {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private rerunRequested = false
  private rerunForce = false
  private inFlight: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(private readonly params: PeriodicJobParams) {}

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.kick('interval'), this.params.intervalMs)
    this.timer.unref?.()
    this.kick('startup')
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.inFlight.catch(() => undefined)
  }

  kick(reason: string): void {
    void this.run(reason).catch(() => undefined)
  }

  run(reason: string, force = false): Promise<void> {
    if (this.stopped) return this.inFlight
    if (this.running) {
      this.rerunRequested = true
      this.rerunForce ||= force
      return this.inFlight
    }

    this.running = true
    let nextReason = reason
    let nextForce = force
    this.inFlight = (async () => {
      do {
        this.rerunRequested = false
        this.rerunForce = false
        await this.params.run(nextReason, nextForce)
        nextReason = 'coalesced'
        nextForce = this.rerunForce
      } while (this.rerunRequested)
    })()
      .catch((error) => {
        log.error(`[${this.params.name}] Run failed (${reason}):`, error)
        throw error
      })
      .finally(() => {
        this.running = false
      })

    return this.inFlight
  }
}
