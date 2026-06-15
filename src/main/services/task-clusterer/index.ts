/**
 * Task clusterer: groups grounded sightings into process candidates.
 *
 * Deterministic and LLM-free, so it can be re-run cheaply and often. Sightings
 * are never modified — clusters + memberships are rebuilt idempotently on every
 * run via ClusterRepository.replaceAll.
 */

import { v4 as uuidv4 } from 'uuid'
import type { StorageService } from '../../storage'
import type { Cluster, ClusterMember } from '../../storage/cluster-repository'
import type { SightingClusterInput } from '../../storage/sighting-repository'
import { TASK_CLUSTER_CONFIG } from '../../../shared/constants'
import log from '../../logger'
import { clusterSightings, type ClusterThresholds } from './cluster-algorithm'

export { clusterSightings, cosine, jaccard } from './cluster-algorithm'
export type { ClusterInput, ClusterGroup } from './cluster-algorithm'

const WEEK_MS = 7 * 86_400_000

export interface ClusteringResult {
  runId: string
  sightingsConsidered: number
  clustersFound: number
  membersAssigned: number
}

function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export interface RunClusteringOptions {
  cosThreshold?: number
  appThreshold?: number
  minClusterSize?: number
  now?: number
}

export function runClustering(
  storage: StorageService,
  options: RunClusteringOptions = {},
): ClusteringResult {
  const now = options.now ?? Date.now()
  const runId = uuidv4()
  const thresholds: ClusterThresholds = {
    cosThreshold: options.cosThreshold ?? TASK_CLUSTER_CONFIG.COS_THRESHOLD,
    appThreshold: options.appThreshold ?? TASK_CLUSTER_CONFIG.APP_THRESHOLD,
    minClusterSize: options.minClusterSize ?? TASK_CLUSTER_CONFIG.MIN_CLUSTER_SIZE,
  }

  const inputs = storage.sightings.getAllForClustering()
  const byId = new Map<string, SightingClusterInput>(inputs.map((s) => [s.id, s]))
  const groups = clusterSightings(inputs, thresholds)

  const clusters: Cluster[] = []
  const members: ClusterMember[] = []

  for (const group of groups) {
    const clusterId = uuidv4()
    const memberInputs = group.memberIds.map((id) => byId.get(id)!).filter(Boolean)

    const appSet = new Set<string>()
    const days = new Set<string>()
    let totalInteractionMin = 0
    let firstSeenAt = Infinity
    let lastSeenAt = -Infinity
    for (const m of memberInputs) {
      for (const a of m.apps) appSet.add(a)
      days.add(dayKey(m.startedAt))
      totalInteractionMin += m.interactionMin
      if (m.startedAt < firstSeenAt) firstSeenAt = m.startedAt
      if (m.startedAt > lastSeenAt) lastSeenAt = m.startedAt
    }

    const spanMs = lastSeenAt - firstSeenAt
    const perWeek = spanMs >= WEEK_MS ? memberInputs.length / (spanMs / WEEK_MS) : null

    // Label/description come from the medoid sighting (representative instance).
    const medoid = storage.sightings.getById(group.medoidId)

    clusters.push({
      id: clusterId,
      label: medoid?.title ?? 'Untitled process',
      description: medoid?.description ?? '',
      apps: [...appSet].sort(),
      sightingCount: memberInputs.length,
      distinctDays: days.size,
      totalInteractionMin: Math.round(totalInteractionMin * 10) / 10,
      firstSeenAt,
      lastSeenAt,
      perWeek: perWeek === null ? null : Math.round(perWeek * 10) / 10,
      medoidSightingId: group.medoidId,
      computedAt: now,
      runId,
    })
    for (const id of group.memberIds) {
      members.push({ clusterId, sightingId: id })
    }
  }

  storage.clusters.replaceAll(clusters, members)

  log.info(
    `[TaskClusterer] ${inputs.length} sightings → ${clusters.length} clusters (${members.length} members), run ${runId}`,
  )

  return {
    runId,
    sightingsConsidered: inputs.length,
    clustersFound: clusters.length,
    membersAssigned: members.length,
  }
}
