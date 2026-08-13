import type { SemanticRunDiagnostics } from './types'

/**
 * The summarization outcome persisted per activity (mirrors summary_model):
 *  - `mode`: which pipeline produced the summary ('video' | 'snapshot' | ''),
 *    or 'passive' for the no-LLM heuristic path stamped by the transformer.
 *  - `reason`: a canonical, queryable category for WHY that mode was chosen —
 *    for fallbacks this is the video-failure cause (video_timeout, etc.).
 *  - `failureDetail`: the raw error string of the deciding failed video attempt
 *    (exact timeout ms / provider 404 text), '' when video succeeded.
 */
export interface SummaryOutcome {
  mode: string
  reason: string
  failureDetail: string
}

/** Classify a single video-attempt error string into a canonical reason. */
function classifyVideoError(error: string): string {
  const e = error.toLowerCase()
  if (e.includes('timed out') || e.includes('timeout')) return 'video_timeout'
  // The video model ran but returned an empty summary — distinct from a
  // zero-byte video file (video_empty_file), which never reaches the model.
  if (e.includes('empty summary')) return 'video_empty_summary'
  if (
    /\b\d{3}\b/.test(error) ||
    e.includes('not found') ||
    e.includes('provider_message') ||
    e.includes('rate limit') ||
    e.includes('unauthorized') ||
    e.includes('forbidden')
  ) {
    return 'video_http_error'
  }
  return 'video_failed_other'
}

/** Map a non-attempt fallbackReason (video never sent / config) to a category. */
function mapFallbackReason(fallbackReason: string | null): string {
  switch (fallbackReason) {
    case 'semantic service is not configured':
      return 'not_configured'
    case 'video unavailable':
      return 'video_unavailable'
    case 'video exceeds configured size limit':
      return 'video_oversize'
    case 'video file empty (zero bytes)':
      return 'video_empty_file'
    case 'video file missing':
      return 'video_missing'
    case 'video pipeline disabled by preference':
      return 'video_disabled'
    case 'no video model configured for active vendor':
      return 'video_no_model'
    case 'all video models marked unsupported (session)':
      return 'video_unsupported'
    case 'no snapshot model configured for active vendor':
      return 'no_snapshot_model'
    case 'snapshot pipeline disabled by preference':
      return 'snapshot_disabled'
    case 'all snapshot models failed':
      return 'all_snapshot_failed'
    case 'all video models failed':
      return 'video_failed_other'
    default:
      return fallbackReason ? 'other' : ''
  }
}

/**
 * Derive the persisted {mode, reason, failureDetail} from a run's diagnostics.
 * Passive (no-LLM) summaries are stamped by the transformer, not here.
 */
export function deriveSummaryOutcome(diagnostics: SemanticRunDiagnostics): SummaryOutcome {
  // Happy path: the video pipeline produced the summary.
  if (diagnostics.chosenMode === 'video') {
    return { mode: 'video', reason: 'video', failureDetail: '' }
  }

  // Otherwise we fell back (or failed). If video was attempted, the first video
  // failure is the cause that pushed us off the video pipeline; prefer its
  // specific category + raw detail. If video was never attempted, classify the
  // fallbackReason instead.
  const firstVideoFailure = diagnostics.attempts.find((a) => a.mode === 'video' && !a.success)
  const reason = firstVideoFailure?.error
    ? classifyVideoError(firstVideoFailure.error)
    : mapFallbackReason(diagnostics.fallbackReason)

  return {
    // chosenMode is 'snapshot' when the snapshot pipeline produced a summary,
    // else null → '' (nothing produced).
    mode: diagnostics.chosenMode ?? '',
    reason,
    failureDetail: firstVideoFailure?.error ?? '',
  }
}
