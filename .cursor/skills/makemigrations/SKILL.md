---
name: makemigrations
description: Create SQLite migrations for Memorylane storage schema changes. Use when interfaces or persisted fields change in src/main/storage/index.ts, when a new column/index/table/trigger is needed, or when the user asks to add a migration similar to 0001_initial_schema.ts.
---

# Create Storage Migration

## Purpose

Keep runtime storage schema in sync with `src/main/storage/index.ts` by adding forward-only migrations in `src/main/storage/migrations/`.

## When to Use

Use this skill when any persisted shape changes, especially:

- `StoredActivity` or `ActivitySummary` field changes in `src/main/storage/index.ts`
- SQL statements in `StorageService` change selected/inserted columns
- New filters require indexes
- Legacy table/data needs migration into current tables

## Rules

1. Never edit or reorder existing migration files after they ship.
2. Always add a new migration with a monotonically increasing 4-digit prefix (`0003_*`, `0004_*`, ...).
3. Migration must be idempotent where possible (`IF EXISTS` / `IF NOT EXISTS`).
4. Migration must be safe on partially migrated user data.
5. Register the new migration in `src/main/storage/migrations/index.ts`.

## Workflow

Copy this checklist and execute in order:

```text
Migration Progress
- [ ] 1) Identify schema delta from index.ts changes
- [ ] 2) Create next migration file in src/main/storage/migrations/
- [ ] 3) Implement migration.up(db) with safe SQL
- [ ] 4) Register migration in src/main/storage/migrations/index.ts
- [ ] 5) Add/update storage migration tests
- [ ] 6) Run tests and lint for touched files
```

### 1) Identify schema delta

Map TypeScript/API changes to SQLite changes:

- Added persisted field -> `ALTER TABLE ... ADD COLUMN` (or backfill strategy)
- Removed field -> usually keep column; stop reading/writing it first, remove later with explicit migration plan
- Renamed field -> add new column + backfill + dual-read/write strategy if needed
- New query pattern -> add index
- New text search shape -> update FTS table/trigger strategy
- Vector shape/dimension changes -> explicit data migration strategy

### 2) Create migration file

Name pattern:

- File: `src/main/storage/migrations/000X_descriptive_name.ts`
- Export: `export const migration: Migration`
- `name` must match file stem exactly (example: `0003_add_window_title_index`)

Template:

```typescript
import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '000X_descriptive_name',
  up(db: Database.Database): void {
    // schema/data updates
  },
}
```

### 3) Implement safe SQL

Preferred patterns:

- `db.exec(...)` for DDL batches
- `db.prepare(...).run()` for parameterized DML
- Guard checks using `sqlite_master` when needed
- Wrap multi-step data migrations in `db.transaction(() => { ... })()`

For data moves:

- Use `INSERT OR IGNORE` where duplicate IDs may exist
- Backfill defaults for new NOT NULL columns
- Drop legacy objects only after successful copy

### 4) Register migration

Update `src/main/storage/migrations/index.ts`:

- Add import for the new migration
- Append to `migrations` array at the end (preserve order)

### 5) Tests

Update `src/main/storage/storage.test.ts` (or related tests) to cover:

- Fresh DB applies all migrations successfully
- Existing DB at previous schema upgrades correctly
- Backfilled/default values are correct
- Expected indexes/tables/triggers exist after migration

### 6) Validate

Run relevant checks:

```bash
npm test -- src/main/storage/storage.test.ts
npm run lint
```

If tests are broad or expensive, run targeted tests first, then full suite when requested.

## Examples in Repo

- Baseline schema setup: `src/main/storage/migrations/0001_initial_schema.ts`
- Legacy data migration + cleanup: `src/main/storage/migrations/0002_migrate_context_events.ts`
