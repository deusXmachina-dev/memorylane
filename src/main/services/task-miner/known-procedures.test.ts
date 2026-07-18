import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles } from '@main/storage/test-utils'
import type { Sighting } from '@main/storage/sighting-repository'
import type { Cluster } from '@main/storage/cluster-repository'
import type { ClusterKind } from '../../../shared/types'
import { getKnownProcedureTitles } from './known-procedures'

const createSighting = (id: string): Sighting => ({
  id,
  title: 'Test sighting',
  subject: '',
  description: 'Did the thing',
  apps: ['TestApp'],
  activityIds: ['act-1'],
  startedAt: 1000,
  endedAt: 2000,
  interactionMin: 5,
  runId: 'run-1',
  detectedAt: 2000,
})

const createCluster = (overrides: Partial<Cluster> & { id: string }): Cluster => ({
  id: overrides.id,
  label: overrides.label ?? '',
  description: overrides.description ?? '',
  centroid: overrides.centroid ?? null,
  kind: overrides.kind ?? '',
  mechanism: overrides.mechanism ?? '',
  steps: overrides.steps ?? [],
  variables: overrides.variables ?? [],
  labelModel: overrides.labelModel ?? '',
  labeledSize: overrides.labeledSize ?? 0,
  createdAt: overrides.createdAt ?? 1000,
  updatedAt: overrides.updatedAt ?? 1000,
})

describe('getKnownProcedureTitles', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_known_procedures_test.db')
  let storage: StorageService
  let nextSighting = 0

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    nextSighting = 0
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  // Create a cluster with `memberCount` attached sightings.
  const cluster = (id: string, label: string, kind: ClusterKind, memberCount: number): void => {
    storage.clusters.create(createCluster({ id, label, kind }))
    for (let i = 0; i < memberCount; i++) {
      const sid = `s${nextSighting++}`
      storage.sightings.add(createSighting(sid))
      storage.clusters.addMembership(id, sid, 100)
    }
  }

  it('includes labeled recurring clusters of any kind, not just procedures', () => {
    cluster('c1', 'Review tenant devices', 'monitoring', 3)
    cluster('c2', 'Draft security questionnaire answers', 'judgment', 2)
    cluster('c3', 'Clear worktree', 'dev-loop', 2)
    const titles = getKnownProcedureTitles(storage)
    expect(titles).toContain('Review tenant devices')
    expect(titles).toContain('Draft security questionnaire answers')
    expect(titles).toContain('Clear worktree')
  })

  it('excludes singletons, even labeled procedure ones', () => {
    cluster('c1', 'One-off provisioning', 'procedure', 1)
    expect(getKnownProcedureTitles(storage)).toEqual([])
  })

  it('excludes unlabeled clusters even when recurring', () => {
    cluster('c1', '', 'procedure', 4)
    cluster('c2', '   ', 'procedure', 4)
    expect(getKnownProcedureTitles(storage)).toEqual([])
  })

  it('dedups case-insensitively, first (more-seen) wins', () => {
    cluster('c1', 'Provision Test Tenant', 'procedure', 5)
    cluster('c2', 'provision test tenant', 'procedure', 2)
    const titles = getKnownProcedureTitles(storage)
    expect(titles).toEqual(['Provision Test Tenant'])
  })

  it('caps the number of titles', () => {
    for (let i = 0; i < 10; i++) cluster(`c${i}`, `Procedure ${i}`, 'procedure', 2)
    expect(getKnownProcedureTitles(storage, 3)).toHaveLength(3)
  })

  it('orders by timesSeen desc, then label asc for equal counts', () => {
    cluster('c1', 'Zebra procedure', 'procedure', 2)
    cluster('c2', 'Alpha procedure', 'procedure', 2)
    cluster('c3', 'Most frequent', 'procedure', 5)
    expect(getKnownProcedureTitles(storage)).toEqual([
      'Most frequent',
      'Alpha procedure',
      'Zebra procedure',
    ])
  })
})
