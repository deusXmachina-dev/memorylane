// Grouping deliberately ignores app names — co-located but distinct tasks
// share apps, so meaning (summary embeddings) is the only grouping signal.
// Thresholds err tight: over-splitting is cheap (the LLM merge phase heals
// it), over-merging a stable cluster is permanent (existing clusters are
// never split).
export const CLUSTERING_CONFIG = {
  /** Cosine floor for both union-find edges and centroid attachment. */
  SIMILARITY_THRESHOLD: 0.75,
  /** Cosine floor for proposing a cluster pair to the LLM as a merge. */
  MERGE_CANDIDATE_THRESHOLD: 0.65,
  /** Most-recent member sightings shown to the LLM per cluster. */
  MAX_SAMPLE_MEMBERS: 15,
  /**
   * Cap on clusters sent for (re)label/classify per run, so a backlog (e.g.
   * every pre-0016 cluster needing a kind) drains over several runs instead of
   * flooding one review call. Merge-candidate clusters ride along uncapped.
   */
  MAX_REVIEW_CLUSTERS_PER_RUN: 20,
  LLM_MAX_ATTEMPTS: 2,
} as const

export interface ClusteringRunSummary {
  newSignatures: number
  attached: number
  newClusters: number
  merged: number
  split: number
  labeled: number
  /** Sightings with no usable activity vectors (never clusterable). */
  unclustered: number
  tokenUsage: { input: number; output: number }
  llmError?: string
}

export function emptyClusteringSummary(): ClusteringRunSummary {
  return {
    newSignatures: 0,
    attached: 0,
    newClusters: 0,
    merged: 0,
    split: 0,
    labeled: 0,
    unclustered: 0,
    tokenUsage: { input: 0, output: 0 },
  }
}

// ---------------------------------------------------------------------------
// LLM review I/O
// ---------------------------------------------------------------------------

/** One sighting as shown to the review LLM. */
export interface ReviewSighting {
  sighting_id: string
  title: string
  description: string
  apps: string[]
  interaction_min: number
  date: string
}

export interface ReviewCluster {
  id: string
  /** Created this run — the only clusters the LLM may split. */
  new: boolean
  label: string
  /** Code-computed over ALL members (not just the sample shown). */
  stats: {
    times_seen: number
    /** Calendar days from first to last sighting, inclusive. */
    span_days: number
    median_active_min: number
  }
  /** Distinct "Replace with:" tails parsed from member descriptions (most recent first, capped). */
  replace_with: string[]
  members: ReviewSighting[]
}

export interface ReviewInput {
  clusters: ReviewCluster[]
  mergeCandidates: [string, string][]
}

export interface ReviewSplitGroup {
  label: string
  description: string
  sighting_ids: string[]
}

export interface ReviewClusterVerdict {
  id: string
  label?: string
  description?: string
  kind?: string
  mechanism_kind?: string
  mechanism?: string
  split?: ReviewSplitGroup[]
}

export interface ReviewMerge {
  merge: string[]
  label: string
  description: string
}

export interface ReviewOutput {
  clusters?: ReviewClusterVerdict[]
  merges?: ReviewMerge[]
}
