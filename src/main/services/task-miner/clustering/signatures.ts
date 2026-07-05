import type { StorageService } from '@main/storage'
import type { Sighting } from '@main/storage/sighting-repository'
import { meanPool, normalize } from './vector-math'
import type { SightingSignature } from './attach'

/**
 * Compute and persist a signature for each sighting: the unit-normalized mean
 * of its activities' embeddings (which are themselves unit-normalized).
 * Sightings whose activity vectors are all gone get a NULL signature row —
 * processed, but permanently unclusterable.
 *
 * Signatures are persisted so later runs never depend on the activities
 * surviving their own pruning schedule.
 */
export function computeAndStoreSignatures(
  storage: StorageService,
  sightings: readonly Sighting[],
  now: number,
): { signatures: SightingSignature[]; unclustered: number } {
  const signatures: SightingSignature[] = []
  let unclustered = 0

  for (const sighting of sightings) {
    const vectorsById = storage.activities.getVectorsByIds(sighting.activityIds)
    const vector = normalize(meanPool([...vectorsById.values()]) ?? [])
    storage.clusters.upsertSignature(sighting.id, vector, now)
    if (vector) {
      signatures.push({ sightingId: sighting.id, vector })
    } else {
      unclustered++
    }
  }

  return { signatures, unclustered }
}

/** Centroid = unit-normalized mean of member signatures (from the signature
 * store, never from activities — activity pruning is harmless here). */
export function recomputeCentroid(storage: StorageService, clusterId: string, now: number): void {
  const signatures = storage.clusters.getSignaturesByClusterId(clusterId)
  const centroid = normalize(meanPool([...signatures.values()]) ?? [])
  storage.clusters.updateCentroid(clusterId, centroid, now)
}
