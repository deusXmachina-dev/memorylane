// Visual Change Detection Configuration (Event-driven baseline model)
export const VISUAL_DETECTOR_CONFIG = {
  ENABLED: true,
  DHASH_THRESHOLD_PERCENT: 8, // Threshold for baseline comparison (1-20%)
}

// Trailing-frame leak trimming at activity boundaries (ActivityProducer).
// The real app switch precedes the observer notification (observed 0.5-2s), so
// the last frame(s) of an activity can visually show the NEXT app.
export const BOUNDARY_TRIM_CONFIG = {
  ENABLED: true,
  CANDIDATE_COUNT: 3, // Trailing frames inspected per finalization
  REFERENCE_COUNT: 2, // Frames used on each side (own activity / after boundary)
  AFTER_REFERENCE_WINDOW_MS: 5_000, // Buffered frames this close after the boundary may serve as after-references on flush
  MIN_LEAK_MARGIN_PERCENT: 0.5, // L1 luminance %: a frame must be this much closer to the after side to be dropped
}

// User Interaction Monitoring Configuration
export const INTERACTION_MONITOR_CONFIG = {
  ENABLED: true,
  TRACK_CLICKS: true,
  TRACK_KEYBOARD: true, // Track typing sessions
  TRACK_SCROLL: true, // Track scroll sessions
  TRACK_APP_CHANGE: true, // Track application/window changes
  CLICK_DEBOUNCE_MS: 3000, // Wait for clicking to stop before emitting event (500-5000ms)
  TYPING_DEBOUNCE_MS: 2000, // Wait for typing to stop before emitting event (500-5000ms)
  SCROLL_DEBOUNCE_MS: 2000, // Wait for scrolling to stop before emitting event (200-2000ms)
  // Force-emit an interim event when a continuous session runs longer than this,
  // so long scroll/typing keeps the event-capturer's window alive instead of
  // being cut by its idle gap. The binding invariant is
  // MAX_SESSION_MS < EVENT_CAPTURER_CONFIG.GAP_TIMEOUT_MS — otherwise a continuous
  // session emits less often than the gap and the downstream window is dropped
  // (guarded by a test in interaction-monitor.test.ts).
  //
  // This is independent of the debounce values above: debounce controls when a
  // session is considered *finished*, while this caps how long a *running* session
  // goes between emits. When a user-configured debounce exceeds this (the UI allows
  // up to 10s), a long session is intentionally split into interim sub-windows —
  // each stamped at receipt time, with no events lost or double-counted — because
  // honoring a debounce longer than the gap would let the window die.
  MAX_SESSION_MS: 4000,
}

// App Watcher Configuration (platform-native subprocess for app/window change detection)
export const APP_WATCHER_CONFIG = {
  MAX_RESTART_RETRIES: 3, // Max automatic restarts after crashes
  RESTART_BACKOFF_MS: 1000, // Base delay between restarts (multiplied by attempt number)
}

// Context Capture Configuration
export const CONTEXT_CAPTURE_CONFIG = {
  ENABLED: false, // Disabled by default (requires permissions)
}

// Screenshot Cleanup Configuration
export const SCREENSHOT_CLEANUP_CONFIG = {
  MAX_AGE_MS: 60 * 60 * 1000, // Delete screenshot files older than 1 hour
  CLEANUP_INTERVAL_MS: 10 * 60 * 1000, // Run cleanup every 10 minutes
}

/** Upper bound of the request-timeout sliders in Advanced settings. */
export const MAX_REQUEST_TIMEOUT_MS = 60 * 60_000

/**
 * Ceiling undici puts on every fetch in the main process. It exists only so a
 * black-holed connection cannot hang forever; the real deadline is the
 * per-call `timeout` each LLM request passes. Kept above
 * MAX_REQUEST_TIMEOUT_MS so it can never preempt a configured deadline —
 * undici's own 300s default did exactly that (issue #268).
 */
export const TRANSPORT_TIMEOUT_MS = 2 * MAX_REQUEST_TIMEOUT_MS

// Activity Window Configuration
export const ACTIVITY_CONFIG = {
  MIN_ACTIVITY_DURATION_MS: 3_000, // Discard activities shorter than 3s
  MAX_ACTIVITY_DURATION_MS: 5 * 60 * 1000, // Force-split after 5 minutes
  MAX_SCREENSHOTS_FOR_LLM: 6, // Max images sent to LLM
  SEMANTIC_REQUEST_TIMEOUT_MS: 120_000, // Per-model semantic request timeout
}

export const LLM_HEALTH_CONFIG = {
  STATUS_POLL_INTERVAL_MS: 5_000, // Renderer reads cached health status (no probe)
  RECOVERY_PROBE_INTERVAL_MS: 60_000, // Re-probe cadence while health is failing
}

// Presence Heartbeat Configuration
// Keeps an event window alive while the user is present but not providing input
// (reading), so a no-input view isn't dropped when the idle gap fires.
export const PRESENCE_MONITOR_CONFIG = {
  ENABLED: true,
  // Heartbeat cadence. The binding invariant is
  // HEARTBEAT_INTERVAL_MS < EVENT_CAPTURER_CONFIG.GAP_TIMEOUT_MS — otherwise the
  // window dies between heartbeats (guarded by a test). Mirrors the
  // INTERACTION_MONITOR_CONFIG.MAX_SESSION_MS keep-alive for active sessions.
  HEARTBEAT_INTERVAL_MS: 4_000,
  // Stop heartbeating once the OS reports this many seconds with no input. Mouse
  // movement resets the OS idle timer, so a present reader counts as active; a
  // genuine walk-away is cut roughly this long after their last movement.
  AWAY_IDLE_SECONDS: 90,
}

// Event Capturer Configuration (gap-based session windowing)
export const EVENT_CAPTURER_CONFIG = {
  GAP_TIMEOUT_MS: 5_000,
  MAX_WINDOW_DURATION_MS: 5 * 60 * 1000, // Safety cap only — most windows close via gap timer
  LATE_EVENT_GRACE_MS: 3_500, // Hold closed windows briefly to absorb debounced late arrivals
}

// OCR Pipeline Configuration
export const OCR_CONFIG = {
  ENABLED: true, // Toggle OCR extraction during activity processing
  MAX_CONCURRENT_ACTIVITIES: 1, // Max activities processing through the pipeline at once
  MAX_CONCURRENT_OCR: 2, // Max parallel OCR subprocesses per activity
  RECOGNITION_MODE: 'accurate' as 'fast' | 'accurate', // macOS Vision recognition level
}

// Screen Capturer Configuration
export const SCREEN_CAPTURER_CONFIG = {
  DEFAULT_INTERVAL_MS: 1000,
  MAX_DIMENSION_PX: 1_920,
}

// User Context Builder Configuration
export const USER_CONTEXT_CONFIG = {
  MODEL: 'minimax/minimax-m3',
  LOOKBACK_DAYS: 7, // Analyze past week of activities
  MIN_ACTIVITIES: 50, // Minimum total activities in DB before first run
  SETTLE_DELAY_MS: 30 * 1000, // 30s after unlock
}

// Pattern Detection Configuration
export const PATTERN_DETECTION_CONFIG = {
  MODEL: 'minimax/minimax-m3',
  LOOKBACK_DAYS: 1, // Days back from today to analyze (1 = yesterday)
  MIN_ACTIVITIES: 200, // Minimum total activities in DB before first run
  // Request deadline for task-mining LLM calls, which scan a whole day in one
  // prompt: the slowest *completed* scan observed on OpenRouter was ~10k output
  // tokens at 15 tok/s, about 11 minutes. Routing picks the backend and a slow
  // one is not a stalled one, so this sits far above the shared default rather
  // than failing work that would have landed. User-configurable via the
  // taskMiningRequestTimeoutMs setting (local endpoints can be far slower).
  REQUEST_TIMEOUT_MS: 20 * 60_000,
}

// Sightings older than this are pruned on every mining run; cluster stats use
// the same window so the timesSeen numerator and observedDays denominator
// cover the same period.
export const SIGHTING_RETENTION_DAYS = 90

// Noise floor for the Patterns view: clusters seen once are hidden unless they
// already cost meaningful time. Presentation-only — clustering, storage, and
// sync are untouched, so a hidden singleton still attaches tomorrow's sighting.
export const CLUSTER_VIEW_CONFIG = {
  MIN_TIMES_SEEN: 2,
  SINGLETON_MIN_TOTAL_ACTIVE_MIN: 30,
  /** Window for cluster stats (frequency denominator). */
  STATS_WINDOW_DAYS: SIGHTING_RETENTION_DAYS,
}

// One-time seed of the sightings/clusters tables from existing history, run
// once per DB (gated on whether it has ever been mined — see
// runTaskBackfillIfNeeded). A manual re-mine goes through the dev "wipe &
// re-mine" action, not a version bump.
export const TASK_BACKFILL = {
  DAYS: 60, // Calendar days back to mine (day-by-day, oldest → newest)
  // Re-cluster at this many-day barrier during backfill so earlier days' labels
  // become known-procedure vocabulary for later days (canonical titles cross-day).
  CLUSTER_EVERY_DAYS: 5,
  // Mining attempts per calendar day before the ledger marks it failed.
  MAX_DAY_ATTEMPTS: 3,
  POLL_INTERVAL_MS: 5 * 60_000,
  // Must exceed POLL_INTERVAL_MS, else a bad day burns MAX_DAY_ATTEMPTS in minutes.
  DAY_COOLDOWN_INITIAL_MS: 10 * 60_000,
  DAY_COOLDOWN_MAX_MS: 30 * 60_000,
  SWEEP_MAX_CONSECUTIVE_FAILURES: 3,
  SWEEP_ABORT_BACKOFF_MS: 10 * 60_000,
  // Days scanned at once, only while more than CLUSTER_EVERY_DAYS days are
  // pending (first launch, gap-fill). A daily sweep stays serial. Matches
  // CLUSTER_EVERY_DAYS so a wave is one round of scans, not a round plus a
  // straggler waiting on the barrier.
  SWEEP_CONCURRENCY: 5,
}

// User-initiated timed capture pause (auto-resumes when the timer elapses).
// Presets are shared between the tray menu and the main-window control.
export const CAPTURE_PAUSE_CONFIG = {
  PRESETS_MINUTES: [15, 30, 60] as const,
  DEFAULT_MINUTES: 30,
}

// Label for a pause preset, shared by the tray menu and the main-window control.
export const formatPauseDuration = (minutes: number): string =>
  minutes === 60 ? '1 hour' : `${minutes} min`

// Managed Key / Subscription Configuration
export const MANAGED_KEY_CONFIG = {
  BACKEND_URL:
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:8000/'
      : 'https://api.trymemorylane.com/',
  POLL_INTERVAL_MS: 5_000,
  POLL_TIMEOUT_MS: 600_000, // 10 minutes
  KEY_REFRESH_INTERVAL_MS: 24 * 60 * 60 * 1000, // 24 hours
}

declare const __MEMORYLANE_BACKEND_URL__: string

// Confirmation phrase required to purge all local data.
// Shared between the main IPC handler and the renderer confirmation UI.
export const PURGE_CONFIRMATION_PHRASE = 'delete-memorylane'

export const ENTERPRISE_BACKEND_CONFIG = {
  // `__MEMORYLANE_BACKEND_URL__` is a Vite build-time define (electron.vite.config.ts).
  // It is absent when this module is imported outside the bundler — e.g. tsx-run
  // CLI scripts — so guard with `typeof` (safe on an undeclared identifier; under
  // Vite the define still substitutes here). CLIs don't use the enterprise
  // backend, so an empty fallback is fine.
  BACKEND_URL: typeof __MEMORYLANE_BACKEND_URL__ !== 'undefined' ? __MEMORYLANE_BACKEND_URL__ : '',
  POLL_INTERVAL_MS: 2_000,
  ACTIVATION_TIMEOUT_MS: 20_000,
  CONSENT_DECISION_TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes
  STATUS_REFRESH_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
}

// Minimum time between automatic log uploads. The uploader polls hourly but only
// ships when the logs changed AND this much time has passed since the last
// upload, bounding uploads to a few per day.
export const LOG_UPLOAD_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
