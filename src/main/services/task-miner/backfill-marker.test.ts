import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createBackfillMarker } from './backfill-marker'
import { TASK_BACKFILL } from '../../../shared/constants'

describe('createBackfillMarker', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-marker-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('is incomplete until marked, then complete', () => {
    const marker = createBackfillMarker(dir)
    expect(marker.isComplete()).toBe(false)
    marker.markComplete()
    expect(marker.isComplete()).toBe(true)
    // A fresh instance reads the same persisted file.
    expect(createBackfillMarker(dir).isComplete()).toBe(true)
  })

  it('writes the current version to the marker file', () => {
    createBackfillMarker(dir).markComplete()
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'task-backfill.json'), 'utf-8'))
    expect(written.version).toBe(TASK_BACKFILL.VERSION)
  })

  it('treats a stored version below the current one as incomplete (re-backfill)', () => {
    fs.writeFileSync(
      path.join(dir, 'task-backfill.json'),
      JSON.stringify({ version: TASK_BACKFILL.VERSION - 1 }),
    )
    expect(createBackfillMarker(dir).isComplete()).toBe(false)
  })

  it('treats a corrupt marker file as incomplete', () => {
    fs.writeFileSync(path.join(dir, 'task-backfill.json'), 'not json')
    expect(createBackfillMarker(dir).isComplete()).toBe(false)
  })
})
