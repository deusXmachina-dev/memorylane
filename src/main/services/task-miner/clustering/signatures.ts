import type { StorageService } from '@main/storage'
import type { Sighting } from '@main/storage/sighting-repository'
import { dot, meanPool, normalize } from './vector-math'
import type { SightingSignature } from './attach'

export type EmbedText = (text: string) => Promise<number[]>

/**
 * Compute and persist a signature for each sighting: the unit-normalized
 * embedding of its miner-written title + description. Embedding the task
 * identity keeps unrelated sightings apart — the previous mean of activity
 * embeddings regressed busy sightings toward the corpus mean and let topics
 * chain together. Sightings whose text embeds to nothing (zero vector) get a
 * NULL signature row — processed, but permanently unclusterable.
 *
 * Signatures are persisted so later runs never re-embed or depend on the
 * miner prompt that wrote the text.
 */
export async function computeAndStoreSignatures(
  storage: StorageService,
  sightings: readonly Sighting[],
  embed: EmbedText,
  now: number,
): Promise<{ signatures: SightingSignature[]; unclustered: number }> {
  const signatures: SightingSignature[] = []
  let unclustered = 0

  for (const sighting of sightings) {
    const text = `${sighting.title}. ${sighting.description}`.trim()
    const vector = normalize(await embed(text))
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
 * store, never recomputed from source text). */
export function recomputeCentroid(storage: StorageService, clusterId: string, now: number): void {
  const signatures = storage.clusters.getSignaturesByClusterId(clusterId)
  const centroid = normalize(meanPool([...signatures.values()]) ?? [])
  storage.clusters.updateCentroid(clusterId, centroid, now)
}

/** Each member's cosine to the cluster centroid — the shared basis for
 * eviction and the split-eligibility coherence stat. */
export function memberSimilarities(
  storage: StorageService,
  clusterId: string,
  centroid: readonly number[],
): { sightingId: string; sim: number }[] {
  const signatures = storage.clusters.getSignaturesByClusterId(clusterId)
  return [...signatures].map(([sightingId, vector]) => ({ sightingId, sim: dot(vector, centroid) }))
}
