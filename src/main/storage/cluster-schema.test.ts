import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { ensureClusterSchema, CLUSTER_SCHEMA_VERSION } from './cluster-schema'

const CLUSTER_TABLES = [
  'sighting_signatures',
  'clusters',
  'cluster_sightings',
  'cluster_merge_declines',
]

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  ).map((r) => r.name)
}

function storedVersion(db: Database.Database): number {
  const row = db.prepare(`SELECT value FROM cluster_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  return row ? Number(row.value) : 0
}

describe('ensureClusterSchema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('creates all cluster tables and stamps the version on a fresh database', () => {
    ensureClusterSchema(db)

    const names = tableNames(db)
    for (const table of CLUSTER_TABLES) expect(names).toContain(table)
    expect(storedVersion(db)).toBe(CLUSTER_SCHEMA_VERSION)
  })

  it('rebuilds an old-shape database (pre-versioning) to the current schema', () => {
    // The shape shipped by former migrations 0015+0016: no cluster_merge_declines,
    // no cluster_meta.
    db.exec(`
      CREATE TABLE sighting_signatures (
        sighting_id TEXT PRIMARY KEY,
        embedding BLOB,
        computed_at INTEGER NOT NULL
      );
      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        centroid BLOB,
        label_model TEXT NOT NULL DEFAULT '',
        labeled_size INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT '',
        mechanism TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE cluster_sightings (
        sighting_id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );
      INSERT INTO clusters (id, created_at, updated_at) VALUES ('old', 1, 1);
      INSERT INTO sighting_signatures (sighting_id, computed_at) VALUES ('s1', 1);
      INSERT INTO cluster_sightings (sighting_id, cluster_id, added_at) VALUES ('s1', 'old', 1);
    `)

    ensureClusterSchema(db)

    expect(tableNames(db)).toContain('cluster_merge_declines')
    expect(storedVersion(db)).toBe(CLUSTER_SCHEMA_VERSION)
    for (const table of CLUSTER_TABLES) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })

  it('is a no-op that preserves data when the version matches', () => {
    ensureClusterSchema(db)
    db.prepare(`INSERT INTO clusters (id, created_at, updated_at) VALUES ('c1', 1, 1)`).run()

    ensureClusterSchema(db)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM clusters`).get()).toEqual({ n: 1 })
  })

  it('wipes derived data when the stored version differs', () => {
    ensureClusterSchema(db)
    db.prepare(`INSERT INTO clusters (id, created_at, updated_at) VALUES ('c1', 1, 1)`).run()
    db.prepare(`UPDATE cluster_meta SET value = ? WHERE key = 'schema_version'`).run(
      String(CLUSTER_SCHEMA_VERSION - 1),
    )

    ensureClusterSchema(db)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM clusters`).get()).toEqual({ n: 0 })
    expect(storedVersion(db)).toBe(CLUSTER_SCHEMA_VERSION)
  })
})
