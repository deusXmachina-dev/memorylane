import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { migration } from './0022_bridge_sighting_active_time'

const MIN = 60_000

function seed(db: Database.Database): void {
  db.exec(`
    CREATE TABLE activities (
      id TEXT PRIMARY KEY,
      start_timestamp INTEGER NOT NULL,
      end_timestamp INTEGER NOT NULL
    );
    CREATE TABLE sightings (
      id TEXT PRIMARY KEY,
      activity_ids TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      interaction_min REAL NOT NULL
    );
  `)
}

function addActivity(db: Database.Database, id: string, startMin: number, endMin: number): void {
  db.prepare(`INSERT INTO activities (id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`).run(
    id,
    startMin * MIN,
    endMin * MIN,
  )
}

function addSighting(db: Database.Database, id: string, ids: string[], stored: number): void {
  const rows = ids.map(
    (aid) =>
      db
        .prepare(`SELECT start_timestamp AS s, end_timestamp AS e FROM activities WHERE id = ?`)
        .get(aid) as { s: number; e: number } | undefined,
  )
  const known = rows.filter((r): r is { s: number; e: number } => r !== undefined)
  db.prepare(
    `INSERT INTO sightings (id, activity_ids, started_at, ended_at, interaction_min) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    JSON.stringify(ids),
    known.length > 0 ? Math.min(...known.map((r) => r.s)) : 0,
    known.length > 0 ? Math.max(...known.map((r) => r.e)) : 0,
    stored,
  )
}

function activeMin(db: Database.Database, id: string): number {
  return (
    db.prepare(`SELECT interaction_min AS m FROM sightings WHERE id = ?`).get(id) as { m: number }
  ).m
}

describe('0022_bridge_sighting_active_time', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    seed(db)
  })

  afterEach(() => {
    db.close()
  })

  it('bridges a short gap and excludes a long one', () => {
    addActivity(db, 'a1', 0, 2)
    addActivity(db, 'a2', 4, 6) // 2-min gap — bridged
    addActivity(db, 'b1', 0, 2)
    addActivity(db, 'b2', 32, 34) // 30-min gap — excluded
    addSighting(db, 'short-gap', ['a1', 'a2'], 4)
    addSighting(db, 'long-gap', ['b1', 'b2'], 4)

    migration.up(db)

    expect(activeMin(db, 'short-gap')).toBe(6)
    expect(activeMin(db, 'long-gap')).toBe(4)
  })

  it('does not double-count overlapping or nested activities', () => {
    addActivity(db, 'o1', 0, 10)
    addActivity(db, 'o2', 5, 15)
    addActivity(db, 'n1', 0, 30)
    addActivity(db, 'n2', 5, 6)
    addSighting(db, 'overlap', ['o1', 'o2'], 20)
    addSighting(db, 'nested', ['n1', 'n2'], 31)

    migration.up(db)

    expect(activeMin(db, 'overlap')).toBe(15)
    expect(activeMin(db, 'nested')).toBe(30)
  })

  it('never exceeds the wall-clock span', () => {
    addActivity(db, 'c1', 0, 5)
    addActivity(db, 'c2', 8, 20)
    addActivity(db, 'c3', 90, 95)
    addSighting(db, 'mixed', ['c1', 'c2', 'c3'], 22)

    migration.up(db)

    const row = db.prepare(`SELECT started_at, ended_at, interaction_min FROM sightings`).get() as {
      started_at: number
      ended_at: number
      interaction_min: number
    }
    expect(row.interaction_min).toBe(25)
    expect(row.interaction_min).toBeLessThanOrEqual((row.ended_at - row.started_at) / MIN)
  })

  it('leaves a sighting whose activities are gone untouched', () => {
    addSighting(db, 'orphan', ['missing-1', 'missing-2'], 7.5)

    migration.up(db)

    expect(activeMin(db, 'orphan')).toBe(7.5)
  })

  it('leaves a sighting whose activities are only partly present untouched', () => {
    addActivity(db, 'p1', 0, 2)
    addSighting(db, 'partial', ['p1', 'missing-1'], 7.5)

    migration.up(db)

    expect(activeMin(db, 'partial')).toBe(7.5)
  })

  it('leaves a sighting citing no activities untouched', () => {
    addSighting(db, 'empty', [], 0)

    migration.up(db)

    expect(activeMin(db, 'empty')).toBe(0)
  })

  it('skips a sighting whose activity_ids is not valid JSON instead of failing the migration', () => {
    addActivity(db, 'v1', 0, 2)
    addActivity(db, 'v2', 4, 6)
    addSighting(db, 'valid', ['v1', 'v2'], 4)
    db.prepare(
      `INSERT INTO sightings (id, activity_ids, started_at, ended_at, interaction_min) VALUES ('broken', 'not json', 0, 0, 3)`,
    ).run()

    expect(() => migration.up(db)).not.toThrow()

    expect(activeMin(db, 'valid')).toBe(6)
    expect(activeMin(db, 'broken')).toBe(3)
  })

  it('is idempotent', () => {
    addActivity(db, 'd1', 0, 2)
    addActivity(db, 'd2', 4, 6)
    addSighting(db, 's', ['d1', 'd2'], 4)

    migration.up(db)
    const once = activeMin(db, 's')
    migration.up(db)

    expect(activeMin(db, 's')).toBe(once)
  })
})
