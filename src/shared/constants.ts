// Visual Change Detection Configuration (Event-driven baseline model)
export const VISUAL_DETECTOR_CONFIG = {
  ENABLED: true,
  DHASH_THRESHOLD_PERCENT: 8, // Threshold for baseline comparison (1-20%)
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

// Activity Window Configuration
export const ACTIVITY_CONFIG = {
  MIN_ACTIVITY_DURATION_MS: 3_000, // Discard activities shorter than 3s
  MAX_ACTIVITY_DURATION_MS: 5 * 60 * 1000, // Force-split after 5 minutes
  MAX_SCREENSHOTS_FOR_LLM: 6, // Max images sent to LLM
  SEMANTIC_REQUEST_TIMEOUT_MS: 120_000, // Per-model semantic request timeout
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
  MODEL: 'google/gemini-3-flash-preview',
  LOOKBACK_DAYS: 7, // Analyze past week of activities
  MIN_ACTIVITIES: 50, // Minimum total activities in DB before first run
  SETTLE_DELAY_MS: 30 * 1000, // 30s after unlock — runs before pattern detection (60s)
}

// Pattern Detection Configuration
export const PATTERN_DETECTION_CONFIG = {
  MODEL: 'moonshotai/kimi-k2.5',
  LOOKBACK_DAYS: 1, // Days back from today to analyze (1 = yesterday)
  MIN_ACTIVITIES: 50, // Minimum total activities in DB before first run
  SETTLE_DELAY_MS: 60 * 1000, // 1 min after unlock before running
}

// Managed Key / Subscription Configuration
export const MANAGED_KEY_CONFIG = {
  BACKEND_URL:
    process.env.NODE_ENV === 'development'
      ? 'http://localhost:8000/'
      : 'https://api.trymemorylane.com/',
  POLL_INTERVAL_MS: 5_000,
  POLL_TIMEOUT_MS: 600_000, // 10 minutes
}
