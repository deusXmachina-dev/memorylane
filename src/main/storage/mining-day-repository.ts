import type Database from 'better-sqlite3'

export type MiningDayStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface MiningDay {
  day: string
  status: MiningDayStatus
  attempts: number
  lastError: string | null
  enqueuedAt: number
  startedAt: number | null
  completedAt: number | null
  nextAttemptAt: number | null
  stats: Record<string, unknown> | null
}

interface MiningDayRow {
  day: string
  status: MiningDayStatus
  attempts: number
  last_error: string | null
  enqueued_at: number
  started_at: number | null
  completed_at: number | null
  next_attempt_at: number | null
  stats: string | null
}

function toMiningDay(row: MiningDayRow): MiningDay {
  return {
    day: row.day,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    enqueuedAt: row.enqueued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    nextAttemptAt: row.next_attempt_at,
    stats: row.stats ? (JSON.parse(row.stats) as Record<string, unknown>) : null,
  }
}

/**
 * Per-day task-mining ledger. Each local calendar day ('YYYY-MM-DD') is a job:
 * pending → running (claimed, attempts+1) → completed, or back to pending on a
 * failed attempt until attempts reach the cap, then failed. `markCompleted` is
 * written to be callable inside the sighting-write transaction so a day's
 * sightings and its completed status commit atomically.
 */
export class MiningDayRepository {
  constructor(private readonly db: Database.Database) {}

  /** Insert missing days as pending; rows that already exist (any status) are untouched. */
  enqueueMissing(days: string[], now: number = Date.now()): number {
    const insert = this.db.prepare(
      'INSERT OR IGNORE INTO mining_days (day, status, enqueued_at) VALUES (?, ?, ?)',
    )
    let inserted = 0
    const run = this.db.transaction(() => {
      for (const day of days) {
        inserted += insert.run(day, 'pending', now).changes
      }
    })
    run()
    return inserted
  }

  /**
   * Claim the oldest pending day whose cooldown has elapsed: mark it running
   * and count the attempt. Oldest-first is load-bearing — earlier days'
   * cluster labels feed the known-procedure vocabulary that later days scan
   * against.
   */
  claimOldestPending(now: number = Date.now()): { day: string; attempts: number } | null {
    const row = this.db
      .prepare(
        `UPDATE mining_days
         SET status = 'running', attempts = attempts + 1, started_at = ?
         WHERE day = (SELECT day FROM mining_days
                      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
                      ORDER BY day ASC LIMIT 1)
         RETURNING day, attempts`,
      )
      .get(now, now) as { day: string; attempts: number } | undefined
    return row ?? null
  }

  markCompleted(day: string, stats: Record<string, unknown>, now: number = Date.now()): void {
    this.db
      .prepare(
        `UPDATE mining_days
         SET status = 'completed', completed_at = ?, stats = ?, last_error = NULL,
             next_attempt_at = NULL
         WHERE day = ?`,
      )
      .run(now, JSON.stringify(stats), day)
  }

  /**
   * Record a failed attempt: back to pending with a cooldown while attempts
   * remain, else failed.
   */
  markAttemptFailed(
    day: string,
    error: string,
    maxAttempts: number,
    cooldownMs: number,
    now: number = Date.now(),
  ): void {
    this.db
      .prepare(
        `UPDATE mining_days
         SET status = CASE WHEN attempts < ? THEN 'pending' ELSE 'failed' END,
             next_attempt_at = CASE WHEN attempts < ? THEN ? ELSE NULL END,
             last_error = ?
         WHERE day = ?`,
      )
      .run(maxAttempts, maxAttempts, now + cooldownMs, error, day)
  }

  /**
   * Startup crash recovery: a row still `running` means the app died mid-mine.
   * The crashed attempt was already counted by the claim, so the row goes back
   * to pending only while attempts remain.
   */
  resetStaleRunning(maxAttempts: number): number {
    return this.db
      .prepare(
        `UPDATE mining_days
         SET status = CASE WHEN attempts < ? THEN 'pending' ELSE 'failed' END,
             last_error = COALESCE(last_error, 'interrupted')
         WHERE status = 'running'`,
      )
      .run(maxAttempts).changes
  }

  /** Give exhausted days a fresh set of attempts (dev "retry failed days"). */
  retryFailed(): number {
    return this.db
      .prepare(
        `UPDATE mining_days SET status = 'pending', attempts = 0, next_attempt_at = NULL
         WHERE status = 'failed'`,
      )
      .run().changes
  }

  hasPending(): boolean {
    return (
      this.db.prepare(`SELECT 1 FROM mining_days WHERE status = 'pending' LIMIT 1`).get() !==
      undefined
    )
  }

  hasClaimablePending(now: number = Date.now()): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM mining_days
           WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           LIMIT 1`,
        )
        .get(now) !== undefined
    )
  }

  nextPendingAttemptAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(next_attempt_at) AS next FROM mining_days
         WHERE status = 'pending' AND next_attempt_at IS NOT NULL`,
      )
      .get() as { next: number | null }
    return row.next
  }

  getRunningDay(): string | null {
    const row = this.db
      .prepare(`SELECT day FROM mining_days WHERE status = 'running' LIMIT 1`)
      .get() as { day: string } | undefined
    return row?.day ?? null
  }

  countByStatus(): Record<MiningDayStatus, number> {
    const counts: Record<MiningDayStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    }
    const rows = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM mining_days GROUP BY status')
      .all() as { status: MiningDayStatus; n: number }[]
    for (const row of rows) counts[row.status] = row.n
    return counts
  }

  getFailed(): MiningDay[] {
    const rows = this.db
      .prepare(`SELECT * FROM mining_days WHERE status = 'failed' ORDER BY day ASC`)
      .all() as MiningDayRow[]
    return rows.map(toMiningDay)
  }

  getAll(): MiningDay[] {
    const rows = this.db
      .prepare('SELECT * FROM mining_days ORDER BY day ASC')
      .all() as MiningDayRow[]
    return rows.map(toMiningDay)
  }

  reset(): void {
    this.db.prepare('DELETE FROM mining_days').run()
  }
}
