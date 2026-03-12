#!/usr/bin/env npx tsx
/**
 * Deletes all patterns and sightings from the database (keeps schemas).
 *
 * Usage:
 *   npm run detect-patterns:prune
 */

import { StorageService } from '../src/main/storage/index'
import { getDefaultDbPath } from '../src/main/paths'

const dbPath = getDefaultDbPath()
const storage = new StorageService(dbPath)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (storage as any).db

const sightings = db.prepare('DELETE FROM pattern_sightings').run()
const patterns = db.prepare('DELETE FROM patterns').run()
console.log(`Deleted ${sightings.changes} sightings, ${patterns.changes} patterns`)

storage.close()
