// Grouping deliberately ignores app names — co-located but distinct tasks
// share apps, so meaning (title+description embeddings) is the only grouping
// signal. Thresholds err tight: over-splitting is cheap (the LLM merge phase
// heals it), over-merging is expensive to unwind. All cosine constants are
// calibrated for title+description signature geometry against real data
// (coherent clusters: mean member→centroid ≥ 0.87; two-topic unions ≤ 0.83;
// same-task pairs median 0.73, cross-task median 0.37).
export const CLUSTERING_CONFIG = {
  /** Cosine floor for average-linkage grouping and centroid attachment. */
  SIMILARITY_THRESHOLD: 0.65,
  /** Cosine floor for proposing a cluster pair to the LLM as a merge. */
  MERGE_CANDIDATE_THRESHOLD: 0.55,
  /**
   * Mean member→centroid cosine below which a multi-member cluster is offered
   * to the LLM as splittable (with its full member list).
   */
  SPLIT_COHERENCE_FLOOR: 0.85,
  /**
   * Member→centroid cosine below which a member is evicted into its own
   * cluster after a centroid refresh. Kept below SIMILARITY_THRESHOLD so a
   * fresh attach can never bounce straight back out — eviction only repairs
   * drift introduced by merges and pruning.
   */
  EVICTION_THRESHOLD: 0.6,
  MAX_EVICTIONS_PER_RUN: 10,
  /** Worst-coherence-first cap on coherence-picked splittable clusters per run. */
  MAX_SPLITTABLE_PER_RUN: 5,
  /** Member sample cap for splittable clusters (larger than the label sample
   * so splits see the mixture, still bounded so a mega-cluster can't blow the
   * prompt — the geometry re-split covers members the LLM never saw). */
  MAX_SPLITTABLE_MEMBERS: 40,
  /** How long a declined merge pair stays off the candidate list. */
  MERGE_DECLINE_TTL_MS: 30 * 24 * 60 * 60 * 1000,
  /** Most-recent member sightings shown to the LLM per non-splittable cluster. */
  MAX_SAMPLE_MEMBERS: 15,
  /**
   * Cap on clusters sent for (re)label/classify per run, so a backlog (e.g.
   * every cluster needing a kind after a rebuild) drains over several runs
   * instead of flooding one review call. Merge-candidate clusters ride along
   * uncapped.
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
  /** Members moved out of a drifted cluster into their own new cluster. */
  evicted: number
  /** Sightings with no usable signature (never clusterable). */
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
    evicted: 0,
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
  /** May be split; shown with the extended member sample. */
  splittable: boolean
  label: string
  /** Code-computed over ALL members (not just the sample shown). */
  stats: {
    times_seen: number
    /** Calendar days from first to last sighting, inclusive. */
    span_days: number
    median_active_min: number
  }
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
  mechanism?: string
  split?: ReviewSplitGroup[]
  /** Mixes unrelated processes and no clean split was possible — re-group deterministically. */
  incoherent?: boolean
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
