import type Database from 'better-sqlite3'

export type MiningDayStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface MiningFailure {
  error: string
  status: number | null
  at: number
  attempts: number
  days: number
}

export interface MiningDay {
  day: string
  status: MiningDayStatus
  attempts: number
  lastError: string | null
  lastErrorStatus: number | null
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
  last_error_status: number | null
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
    lastErrorStatus: row.last_error_status,
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
             last_error_status = NULL, next_attempt_at = NULL
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
    status: number | null,
    maxAttempts: number,
    cooldownMs: number,
    now: number = Date.now(),
  ): void {
    this.db
      .prepare(
        `UPDATE mining_days
         SET status = CASE WHEN attempts < ? THEN 'pending' ELSE 'failed' END,
             next_attempt_at = CASE WHEN attempts < ? THEN ? ELSE NULL END,
             last_error = ?, last_error_status = ?
         WHERE day = ?`,
      )
      .run(maxAttempts, maxAttempts, now + cooldownMs, error, status, day)
  }

  /**
   * Hand a claimed day back unspent: the provider throttled us or the network
   * was down, so the day never got a real attempt. Refunds the claim's attempt increment and leaves
   * it immediately claimable — the sweep-level backoff does the waiting.
   */
  releaseClaim(day: string, error: string): void {
    this.db
      .prepare(
        `UPDATE mining_days
         SET status = 'pending', attempts = MAX(attempts - 1, 0), started_at = NULL,
             next_attempt_at = NULL, last_error = ?
         WHERE day = ?`,
      )
      .run(error, day)
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
             next_attempt_at = NULL,
             last_error = COALESCE(last_error, 'interrupted')
         WHERE status = 'running'`,
      )
      .run(maxAttempts).changes
  }

  /** Give exhausted days a fresh set of attempts. */
  retryFailed(): number {
    return this.db
      .prepare(
        `UPDATE mining_days
         SET status = 'pending', attempts = 0, next_attempt_at = NULL,
             last_error = NULL, last_error_status = NULL
         WHERE status = 'failed'`,
      )
      .run().changes
  }

  clearCooldowns(): number {
    return this.db
      .prepare(
        `UPDATE mining_days
         SET next_attempt_at = NULL, last_error = NULL, last_error_status = NULL
         WHERE status = 'pending' AND (next_attempt_at IS NOT NULL OR last_error IS NOT NULL)`,
      )
      .run().changes
  }

  getLatestFailure(): MiningFailure | null {
    const rows = this.db
      .prepare(
        `SELECT last_error, last_error_status, started_at, attempts FROM mining_days
         WHERE status IN ('pending', 'failed')
           AND last_error IS NOT NULL AND last_error != 'interrupted'
           AND started_at IS NOT NULL
           AND started_at > COALESCE(
             (SELECT MAX(completed_at) FROM mining_days WHERE status = 'completed'), 0)
         ORDER BY started_at DESC`,
      )
      .all() as {
      last_error: string
      last_error_status: number | null
      started_at: number
      attempts: number
    }[]
    if (rows.length === 0) return null
    const latest = rows[0]
    return {
      error: latest.last_error,
      status: latest.last_error_status,
      at: latest.started_at,
      attempts: latest.attempts,
      days: rows.length,
    }
  }

  /** Earliest time any pending day becomes claimable (no cooldown counts as 0); null when nothing is pending. */
  nextClaimableAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(COALESCE(next_attempt_at, 0)) AS next FROM mining_days
         WHERE status = 'pending'`,
      )
      .get() as { next: number | null }
    return row.next
  }

  /** Oldest day currently being mined; a sweep may have several in flight. */
  getRunningDay(): string | null {
    const row = this.db
      .prepare(`SELECT day FROM mining_days WHERE status = 'running' ORDER BY day ASC LIMIT 1`)
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
