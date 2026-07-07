#!/usr/bin/env npx tsx
/**
 * Dumps the production ReviewInput serialization of real clusters from a
 * MemoryLane DB — the raw material for cluster-review eval fixtures. Copy the
 * clusters you want into a fixture JSON, hand-author `expected`, done.
 *
 * Usage:
 *   npm run dump-review-input                       (dev DB, all >=2-member clusters)
 *   npm run dump-review-input -- --db /path/to.db --min-members 1 --out snapshot.json
 */

import * as fs from 'fs'
import { StorageService } from '../src/main/storage/index'
import type { Cluster } from '../src/main/storage/cluster-repository'
import { getDefaultDbPath } from '../src/main/utils/paths'
import { toReviewCluster, CLUSTERING_CONFIG } from '../src/main/services/task-miner/clustering'
import { memberSimilarities } from '../src/main/services/task-miner/clustering/signatures'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const dbPath = arg('--db') ?? getDefaultDbPath()
const minMembers = Number(arg('--min-members') ?? 2)
const out = arg('--out')

const storage = new StorageService(dbPath)

// Mirror production's coherence-based splittable flag so dumps reproduce the
// member sample the review LLM actually sees.
const isSplittable = (c: Cluster): boolean => {
  if (!c.centroid) return false
  const sims = memberSimilarities(storage, c.id, c.centroid)
  if (sims.length === 0) return false
  const coherence = sims.reduce((sum, s) => sum + s.sim, 0) / sims.length
  return coherence < CLUSTERING_CONFIG.SPLIT_COHERENCE_FLOOR
}

try {
  const clusters = storage.clusters
    .getAll()
    .filter((c) => storage.clusters.getMemberCount(c.id) >= minMembers)
    .map((c) => toReviewCluster(storage, c, isSplittable(c)))
  const snapshot = { clusters, mergeCandidates: [] as [string, string][] }
  const json = JSON.stringify(snapshot, null, 2)
  if (out) {
    fs.writeFileSync(out, json, 'utf8')
    console.error(`Wrote ${clusters.length} clusters from ${dbPath} to ${out}`)
  } else {
    console.log(json)
    console.error(`\n${clusters.length} clusters from ${dbPath}`)
  }
} finally {
  storage.close()
}
