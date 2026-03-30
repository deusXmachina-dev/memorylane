import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import * as path from 'path'
import { deleteDbFiles } from './test-utils'
import type { Pattern, PatternSighting } from './pattern-repository'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const createPattern = (overrides: Partial<Pattern> & { id: string }): Pattern => ({
  id: overrides.id,
  name: overrides.name ?? 'Test Pattern',
  description: overrides.description ?? 'A recurring workflow',
  apps: overrides.apps ?? ['VS Code'],
  automationIdea: overrides.automationIdea ?? 'Could be automated with a script',
  createdAt: overrides.createdAt ?? 1000,
  rejectedAt: overrides.rejectedAt ?? null,
  promptCopiedAt: overrides.promptCopiedAt ?? null,
  approvedAt: overrides.approvedAt ?? null,
})

const createSighting = (
  overrides: Partial<PatternSighting> & { id: string; patternId: string },
): PatternSighting => ({
  id: overrides.id,
  patternId: overrides.patternId,
  detectedAt: overrides.detectedAt ?? 2000,
  runId: overrides.runId ?? 'run-1',
  evidence: overrides.evidence ?? 'Saw it happen',
  activityIds: overrides.activityIds ?? ['act-1', 'act-2'],
  confidence: overrides.confidence ?? 0.85,
  durationEstimateMin: overrides.durationEstimateMin ?? null,
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PatternRepository', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'temp_pattern_repo_test.db')
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

  // -----------------------------------------------------------------------
  // addPattern + patternCount
  // -----------------------------------------------------------------------

  describe('addPattern + patternCount', () => {
    it('should add a pattern and count returns 1', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-1' }))
      expect(storage.patterns.patternCount()).toBe(1)
    })

    it('INSERT OR IGNORE: adding same id twice does not throw or duplicate', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-dup' }))
      storage.patterns.addPattern(createPattern({ id: 'p-dup', name: 'Different Name' }))
      expect(storage.patterns.patternCount()).toBe(1)
    })

    it('excludes rejected patterns from the count', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-active' }))
      storage.patterns.addPattern(createPattern({ id: 'p-rejected' }))
      storage.patterns.rejectPattern('p-rejected')

      expect(storage.patterns.patternCount()).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // getPatternById
  // -----------------------------------------------------------------------

  describe('getPatternById', () => {
    it('should return pattern with stats (sightingCount=0, lastSeenAt=null, lastConfidence=null)', () => {
      storage.patterns.addPattern(
        createPattern({ id: 'p-get', name: 'My Pattern', apps: ['Chrome', 'Slack'] }),
      )

      const result = storage.patterns.getPatternById('p-get')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('p-get')
      expect(result!.name).toBe('My Pattern')
      expect(result!.apps).toEqual(['Chrome', 'Slack'])
      expect(result!.sightingCount).toBe(0)
      expect(result!.lastSeenAt).toBeNull()
      expect(result!.lastConfidence).toBeNull()
    })

    it('should return null for nonexistent id', () => {
      expect(storage.patterns.getPatternById('nope')).toBeNull()
    })

    it('should return correct stats after sightings are added', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-stats' }))
      storage.patterns.addSighting(
        createSighting({ id: 's-1', patternId: 'p-stats', detectedAt: 3000, confidence: 0.7 }),
      )
      storage.patterns.addSighting(
        createSighting({ id: 's-2', patternId: 'p-stats', detectedAt: 5000, confidence: 0.95 }),
      )

      const result = storage.patterns.getPatternById('p-stats')!

      expect(result.sightingCount).toBe(2)
      expect(result.lastSeenAt).toBe(5000)
      expect(result.lastConfidence).toBe(0.95)
    })
  })

  // -----------------------------------------------------------------------
  // getAllPatterns
  // -----------------------------------------------------------------------

  describe('getAllPatterns', () => {
    it('should return empty array when no patterns', () => {
      expect(storage.patterns.getAllPatterns()).toEqual([])
    })

    it('should return all patterns ordered by sighting count desc', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-few', name: 'Few' }))
      storage.patterns.addPattern(createPattern({ id: 'p-many', name: 'Many' }))

      // p-many gets 3 sightings, p-few gets 1
      storage.patterns.addSighting(createSighting({ id: 's-m1', patternId: 'p-many', runId: 'r1' }))
      storage.patterns.addSighting(createSighting({ id: 's-m2', patternId: 'p-many', runId: 'r2' }))
      storage.patterns.addSighting(createSighting({ id: 's-m3', patternId: 'p-many', runId: 'r3' }))
      storage.patterns.addSighting(createSighting({ id: 's-f1', patternId: 'p-few', runId: 'r1' }))

      const all = storage.patterns.getAllPatterns()

      expect(all.length).toBe(2)
      expect(all[0].id).toBe('p-many')
      expect(all[0].sightingCount).toBe(3)
      expect(all[1].id).toBe('p-few')
      expect(all[1].sightingCount).toBe(1)
    })

    it('should compute estimatedHoursPerWeek from sighting durations and span', () => {
      const DAY = 86_400_000
      storage.patterns.addPattern(createPattern({ id: 'p-dur' }))

      // 8 sightings over 7 days (span = 7 * DAY from first to last), each lasting 30 min
      // freq = 8/7 * 7 = 8/week, hours = 8 * 30 / 60 = 4.0
      for (let i = 0; i < 8; i++) {
        storage.patterns.addSighting(
          createSighting({
            id: `s-dur-${i}`,
            patternId: 'p-dur',
            detectedAt: 1000 + i * DAY,
            durationEstimateMin: 30,
          }),
        )
      }

      const p = storage.patterns.getAllPatterns().find((p) => p.id === 'p-dur')!
      expect(p.estimatedHoursPerWeek).toBe(4)
    })

    it('should return null estimatedHoursPerWeek when no duration data', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-no-dur' }))
      storage.patterns.addSighting(
        createSighting({ id: 's-nd-1', patternId: 'p-no-dur', detectedAt: 1000 }),
      )
      storage.patterns.addSighting(
        createSighting({ id: 's-nd-2', patternId: 'p-no-dur', detectedAt: 90_000_000 }),
      )

      const p = storage.patterns.getAllPatterns().find((p) => p.id === 'p-no-dur')!
      expect(p.estimatedHoursPerWeek).toBeNull()
    })

    it('should return null estimatedHoursPerWeek with fewer than 2 sightings', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-single' }))
      storage.patterns.addSighting(
        createSighting({
          id: 's-single',
          patternId: 'p-single',
          detectedAt: 1000,
          durationEstimateMin: 30,
        }),
      )

      const p = storage.patterns.getAllPatterns().find((p) => p.id === 'p-single')!
      expect(p.estimatedHoursPerWeek).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // searchPatterns
  // -----------------------------------------------------------------------

  describe('searchPatterns', () => {
    it('should match by name', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-s1', name: 'Morning standup' }))
      storage.patterns.addPattern(createPattern({ id: 'p-s2', name: 'Code review' }))

      const results = storage.patterns.searchPatterns('standup')

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('p-s1')
    })

    it('should match by description', () => {
      storage.patterns.addPattern(
        createPattern({ id: 'p-d1', description: 'Opens Jira then Slack every morning' }),
      )

      const results = storage.patterns.searchPatterns('Jira')

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('p-d1')
    })

    it('should match by app in JSON array', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-app', apps: ['Figma', 'Chrome'] }))
      storage.patterns.addPattern(createPattern({ id: 'p-other', apps: ['Terminal'] }))

      const results = storage.patterns.searchPatterns('Figma')

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('p-app')
    })

    it('should return empty for no match', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-nm', name: 'Something' }))

      expect(storage.patterns.searchPatterns('zzz_nonexistent')).toEqual([])
    })

    it('should exclude rejected patterns from search results', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-search-active', name: 'Sync report' }))
      storage.patterns.addPattern(createPattern({ id: 'p-search-rejected', name: 'Sync status' }))
      storage.patterns.rejectPattern('p-search-rejected')

      const results = storage.patterns.searchPatterns('Sync')
      expect(results.map((p) => p.id)).toEqual(['p-search-active'])
    })
  })

  // -----------------------------------------------------------------------
  // addSighting + getSightingsByRunId
  // -----------------------------------------------------------------------

  describe('addSighting + getSightingsByRunId', () => {
    it('should add sighting and retrieve by run id', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-sight' }))
      storage.patterns.addSighting(
        createSighting({
          id: 'sig-1',
          patternId: 'p-sight',
          runId: 'run-abc',
          evidence: 'User opened Chrome then Slack',
          activityIds: ['a1', 'a2', 'a3'],
          confidence: 0.92,
        }),
      )

      const sightings = storage.patterns.getSightingsByRunId('run-abc')

      expect(sightings.length).toBe(1)
      expect(sightings[0].id).toBe('sig-1')
      expect(sightings[0].patternId).toBe('p-sight')
      expect(sightings[0].evidence).toBe('User opened Chrome then Slack')
      expect(sightings[0].activityIds).toEqual(['a1', 'a2', 'a3'])
      expect(sightings[0].confidence).toBe(0.92)
    })

    it('should return empty array for unknown run id', () => {
      expect(storage.patterns.getSightingsByRunId('unknown')).toEqual([])
    })

    it('should order by detected_at desc', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-order' }))
      storage.patterns.addSighting(
        createSighting({ id: 'o-1', patternId: 'p-order', runId: 'run-x', detectedAt: 1000 }),
      )
      storage.patterns.addSighting(
        createSighting({ id: 'o-2', patternId: 'p-order', runId: 'run-x', detectedAt: 3000 }),
      )
      storage.patterns.addSighting(
        createSighting({ id: 'o-3', patternId: 'p-order', runId: 'run-x', detectedAt: 2000 }),
      )

      const sightings = storage.patterns.getSightingsByRunId('run-x')

      expect(sightings.map((s) => s.id)).toEqual(['o-2', 'o-3', 'o-1'])
    })
  })

  // -----------------------------------------------------------------------
  // getLastRunTimestamp
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // rejectPattern
  // -----------------------------------------------------------------------

  describe('rejectPattern', () => {
    it('should filter rejected patterns from getAllPatterns', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-keep', name: 'Keep' }))
      storage.patterns.addPattern(createPattern({ id: 'p-reject', name: 'Reject' }))

      storage.patterns.rejectPattern('p-reject')

      const all = storage.patterns.getAllPatterns()
      expect(all.length).toBe(1)
      expect(all[0].id).toBe('p-keep')
    })

    it('should still be accessible via getPatternById', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-rej2' }))
      storage.patterns.rejectPattern('p-rej2')

      const result = storage.patterns.getPatternById('p-rej2')
      expect(result).not.toBeNull()
      expect(result!.rejectedAt).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // approvePattern
  // -----------------------------------------------------------------------

  describe('approvePattern', () => {
    it('should set approved_at timestamp', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-approve' }))

      storage.patterns.approvePattern('p-approve')

      const result = storage.patterns.getPatternById('p-approve')!
      expect(result.approvedAt).toBeGreaterThan(0)
    })

    it('should keep pattern visible in getAllPatterns', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-approve-visible' }))

      storage.patterns.approvePattern('p-approve-visible')

      const all = storage.patterns.getAllPatterns()
      expect(all.some((p) => p.id === 'p-approve-visible')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // markPromptCopied
  // -----------------------------------------------------------------------

  describe('markPromptCopied', () => {
    it('should set prompt_copied_at timestamp', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-copy' }))

      storage.patterns.markPromptCopied('p-copy')

      const result = storage.patterns.getPatternById('p-copy')!
      expect(result.promptCopiedAt).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // new columns default to null
  // -----------------------------------------------------------------------

  describe('new status columns', () => {
    it('should default rejected_at, prompt_copied_at, and approved_at to null', () => {
      storage.patterns.addPattern(createPattern({ id: 'p-defaults' }))

      const result = storage.patterns.getPatternById('p-defaults')!
      expect(result.rejectedAt).toBeNull()
      expect(result.promptCopiedAt).toBeNull()
      expect(result.approvedAt).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // getLastRunTimestamp
  // -----------------------------------------------------------------------

  describe('getLastRunTimestamp', () => {
    it('should return null when no detection runs are recorded', () => {
      expect(storage.patterns.getLastRunTimestamp()).toBeNull()
    })

    it('should return the max ran_at across detection runs', () => {
      storage.patterns.recordRun('run-1', 2)
      storage.patterns.recordRun('run-2', 0)
      storage.patterns.recordRun('run-3', 1)

      const latest = storage.patterns.getLastRunTimestamp()
      expect(latest).not.toBeNull()
      expect(latest!).toBeGreaterThan(0)
    })
  })
})
