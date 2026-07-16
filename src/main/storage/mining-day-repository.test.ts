import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import type Database from 'better-sqlite3'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import { migrations } from './migrations'
import { deleteDbFiles } from './test-utils'

describe('MiningDayRepository', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_mining_day_repo_test.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('enqueues missing days and ignores existing rows of any status', () => {
    expect(storage.miningDays.enqueueMissing(['2026-07-01', '2026-07-02'])).toBe(2)
    storage.miningDays.markCompleted('2026-07-01', { candidatesKept: 3 })

    expect(storage.miningDays.enqueueMissing(['2026-07-01', '2026-07-02', '2026-07-03'])).toBe(1)

    const all = storage.miningDays.getAll()
    expect(all).toHaveLength(3)
    expect(all.find((d) => d.day === '2026-07-01')?.status).toBe('completed')
    expect(all.find((d) => d.day === '2026-07-01')?.stats).toEqual({ candidatesKept: 3 })
  })

  it('claims the oldest pending day and counts the attempt', () => {
    storage.miningDays.enqueueMissing(['2026-07-03', '2026-07-01', '2026-07-02'])

    const claim = storage.miningDays.claimOldestPending(5000)
    expect(claim).toEqual({ day: '2026-07-01', attempts: 1 })
    const row = storage.miningDays.getAll().find((d) => d.day === '2026-07-01')
    expect(row?.status).toBe('running')
    expect(row?.startedAt).toBe(5000)

    // A running day is not claimable; the next claim moves on.
    expect(storage.miningDays.claimOldestPending()?.day).toBe('2026-07-02')
  })

  it('returns null when nothing is pending', () => {
    expect(storage.miningDays.claimOldestPending()).toBeNull()
    expect(storage.miningDays.hasPending()).toBe(false)
  })

  it('sends a failed attempt back to pending until attempts are exhausted', () => {
    storage.miningDays.enqueueMissing(['2026-07-01'])

    for (let attempt = 1; attempt <= 3; attempt++) {
      const claim = storage.miningDays.claimOldestPending()
      expect(claim).toEqual({ day: '2026-07-01', attempts: attempt })
      storage.miningDays.markAttemptFailed('2026-07-01', `boom ${attempt}`, 3)
    }

    const row = storage.miningDays.getAll()[0]
    expect(row.status).toBe('failed')
    expect(row.lastError).toBe('boom 3')
    expect(storage.miningDays.claimOldestPending()).toBeNull()
  })

  it('completing a day clears its error and stores stats', () => {
    storage.miningDays.enqueueMissing(['2026-07-01'])
    storage.miningDays.claimOldestPending()
    storage.miningDays.markAttemptFailed('2026-07-01', 'boom', 3)
    storage.miningDays.claimOldestPending()

    storage.miningDays.markCompleted('2026-07-01', { candidatesKept: 2 }, 9000)

    const row = storage.miningDays.getAll()[0]
    expect(row.status).toBe('completed')
    expect(row.lastError).toBeNull()
    expect(row.completedAt).toBe(9000)
  })

  it('resets stale running rows on startup, honoring the attempt cap', () => {
    storage.miningDays.enqueueMissing(['2026-07-01', '2026-07-02'])
    storage.miningDays.claimOldestPending() // 07-01, attempt 1
    expect(storage.miningDays.resetStaleRunning(3)).toBe(1)
    expect(storage.miningDays.getAll().find((d) => d.day === '2026-07-01')?.status).toBe('pending')

    // Exhaust attempts, then crash mid-run: stale reset marks it failed.
    storage.miningDays.claimOldestPending() // 07-01, attempt 2
    storage.miningDays.markAttemptFailed('2026-07-01', 'boom', 3)
    storage.miningDays.claimOldestPending() // 07-01, attempt 3
    expect(storage.miningDays.resetStaleRunning(3)).toBe(1)
    expect(storage.miningDays.getAll().find((d) => d.day === '2026-07-01')?.status).toBe('failed')
  })

  it('retryFailed re-opens exhausted days with fresh attempts', () => {
    storage.miningDays.enqueueMissing(['2026-07-01'])
    storage.miningDays.claimOldestPending()
    storage.miningDays.markAttemptFailed('2026-07-01', 'boom', 1)
    expect(storage.miningDays.getFailed()).toHaveLength(1)

    expect(storage.miningDays.retryFailed()).toBe(1)

    const claim = storage.miningDays.claimOldestPending()
    expect(claim).toEqual({ day: '2026-07-01', attempts: 1 })
  })

  it('counts by status and reports the running day and max day', () => {
    storage.miningDays.enqueueMissing(['2026-07-01', '2026-07-02', '2026-07-03'])
    storage.miningDays.claimOldestPending()
    storage.miningDays.markCompleted('2026-07-03', {})

    expect(storage.miningDays.countByStatus()).toEqual({
      pending: 1,
      running: 1,
      completed: 1,
      failed: 0,
    })
    expect(storage.miningDays.getRunningDay()).toBe('2026-07-01')
    expect(storage.miningDays.getMaxDay()).toBe('2026-07-03')
  })
})

describe('migration 0016_add_mining_days', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_migration_0016_test.db')
  let storage: StorageService
  let db: Database.Database

  const idx0016 = migrations.findIndex((m) => m.name === '0016_add_mining_days')

  const localDay = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    // StorageService loads the sqlite-vec extension migration 0001 needs.
    storage = new StorageService(TEST_DB_PATH)
    db = storage.getDatabase()
    for (const m of migrations.slice(0, idx0016)) m.up(db)
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('seeds completed rows for window days before the last run and drops mining_runs', () => {
    const daysAgo = (n: number): Date => {
      const now = new Date()
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
    }
    // Last run 5 days ago → window days older than that are settled.
    db.prepare('INSERT INTO mining_runs (ran_at) VALUES (?)').run(daysAgo(5).getTime())

    migrations[idx0016].up(db)

    const rows = db.prepare('SELECT day, status, stats FROM mining_days ORDER BY day').all() as {
      day: string
      status: string
      stats: string
    }[]
    expect(rows).toHaveLength(55) // days 60..6 ago
    expect(rows[0].day).toBe(localDay(daysAgo(60)))
    expect(rows[rows.length - 1].day).toBe(localDay(daysAgo(6)))
    expect(rows.every((r) => r.status === 'completed')).toBe(true)
    expect(JSON.parse(rows[0].stats)).toEqual({ seeded: true })

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mining_runs'`)
      .all()
    expect(tables).toHaveLength(0)
  })

  it('seeds nothing for a never-mined DB', () => {
    migrations[idx0016].up(db)

    expect(db.prepare('SELECT COUNT(*) AS n FROM mining_days').get()).toEqual({ n: 0 })
  })
})
