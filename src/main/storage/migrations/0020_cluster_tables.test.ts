import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { migration } from './0020_cluster_tables'

const TABLES = ['clusters', 'cluster_sightings', 'sighting_signatures', 'cluster_merge_declines']

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  ).map((r) => r.name)
}

function seedV5(db: Database.Database): void {
  db.exec(`
    CREATE TABLE cluster_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO cluster_meta (key, value) VALUES ('schema_version', '5');
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
      steps TEXT NOT NULL DEFAULT '[]',
      variables TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE cluster_sightings (
      sighting_id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      added_at INTEGER NOT NULL
    );
    CREATE INDEX idx_cluster_sightings_cluster ON cluster_sightings(cluster_id);
    CREATE TABLE cluster_merge_declines (
      cluster_a TEXT NOT NULL,
      cluster_b TEXT NOT NULL,
      declined_at INTEGER NOT NULL,
      PRIMARY KEY (cluster_a, cluster_b)
    );
  `)
}

describe('0020_cluster_tables', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('creates empty cluster tables on a fresh database', () => {
    migration.up(db)

    const names = tableNames(db)
    for (const table of TABLES) expect(names).toContain(table)
    expect(names).not.toContain('cluster_meta')
    expect(db.prepare(`SELECT COUNT(*) AS n FROM clusters`).get()).toEqual({ n: 0 })
  })

  it('wipes derived tables on a pre-v5 database', () => {
    seedV5(db)
    db.prepare(`UPDATE cluster_meta SET value = '4' WHERE key = 'schema_version'`).run()
    db.prepare(`INSERT INTO clusters (id, created_at, updated_at) VALUES ('old', 1, 1)`).run()

    migration.up(db)

    expect(db.prepare(`SELECT COUNT(*) AS n FROM clusters`).get()).toEqual({ n: 0 })
    expect(tableNames(db)).not.toContain('cluster_meta')
  })

  it('preserves v5 data and drops the dead columns', () => {
    seedV5(db)
    const insert = db.prepare(
      `INSERT INTO clusters (id, label, kind, mechanism, labeled_size, steps, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    )
    insert.run('judged', 'Check dashboards', 'monitoring', '', 3, '["App: check"]')
    insert.run('proc', 'Send invoices', 'procedure', 'A script.', 2, '["App: send"]')
    db.prepare(
      `INSERT INTO cluster_sightings (sighting_id, cluster_id, added_at) VALUES ('s1', 'judged', 1)`,
    ).run()
    db.prepare(
      `INSERT INTO sighting_signatures (sighting_id, embedding, computed_at) VALUES ('s1', NULL, 1)`,
    ).run()
    db.prepare(
      `INSERT INTO cluster_merge_declines (cluster_a, cluster_b, declined_at) VALUES ('judged', 'proc', 1)`,
    ).run()

    migration.up(db)

    const cols = (db.prepare(`PRAGMA table_info(clusters)`).all() as { name: string }[]).map(
      (c) => c.name,
    )
    expect(cols).not.toContain('kind')
    expect(cols).not.toContain('label_model')
    expect(cols).not.toContain('updated_at')

    const judged = db.prepare(`SELECT * FROM clusters WHERE id = 'judged'`).get() as Record<
      string,
      unknown
    >
    expect(judged.label).toBe('Check dashboards')
    expect(judged.mechanism).toBe('')
    expect(judged.labeled_size).toBe(3)
    const proc = db.prepare(`SELECT * FROM clusters WHERE id = 'proc'`).get() as Record<
      string,
      unknown
    >
    expect(proc.mechanism).toBe('A script.')
    expect(db.prepare(`SELECT COUNT(*) AS n FROM cluster_sightings`).get()).toEqual({ n: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM sighting_signatures`).get()).toEqual({ n: 1 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM cluster_merge_declines`).get()).toEqual({ n: 1 })
  })

  it('requeues labeled clusters whose classification was still pending', () => {
    seedV5(db)
    const insert = db.prepare(
      `INSERT INTO clusters (id, label, kind, labeled_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1)`,
    )
    insert.run('pending', 'Provision tenant', '', 4)
    insert.run('judged', 'Check dashboards', 'monitoring', 4)
    insert.run('unlabeled', '', '', 0)

    migration.up(db)

    const sizes = Object.fromEntries(
      (
        db.prepare(`SELECT id, labeled_size FROM clusters`).all() as {
          id: string
          labeled_size: number
        }[]
      ).map((r) => [r.id, r.labeled_size]),
    )
    expect(sizes).toEqual({ pending: 0, judged: 4, unlabeled: 0 })
  })
})
