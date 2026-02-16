// Visual Change Detection Configuration (Event-driven baseline model)
export const VISUAL_DETECTOR_CONFIG = {
  ENABLED: true,
  DHASH_THRESHOLD_PERCENT: 6, // Threshold for baseline comparison (1-20%)
}

// User Interaction Monitoring Configuration
export const INTERACTION_MONITOR_CONFIG = {
  ENABLED: true,
  TRACK_CLICKS: true,
  TRACK_KEYBOARD: true, // Track typing sessions
  TRACK_SCROLL: true, // Track scroll sessions
  TRACK_APP_CHANGE: true, // Track application/window changes
  CLICK_THROTTLE_MS: 1000, // Minimum interval between forwarded click events (500-5000ms)
  TYPING_SESSION_TIMEOUT_MS: 2000, // Consider typing stopped after 2s of no keys (500-5000ms)
  SCROLL_SESSION_TIMEOUT_MS: 2000, // Consider scrolling stopped after 500ms (200-2000ms)
  APP_CHANGE_POLL_MS: 500, // Poll active window every 500ms
  APP_CHANGE_FAILURE_SKIPS_N_POLLS_AFTER_ERROR: 10, // Number of polls to skip after an error
  APP_CHANGE_IDLE_TIMEOUT_MS: 5000, // Stop polling after 5s of no user interaction
}

// Capture Rate Limiting Configuration
export const CAPTURE_RATE_CONFIG = {
  MIN_CAPTURE_INTERVAL_MS: 5000, // Minimum time between interaction-triggered captures (1000-30000ms)
  MAX_CONCURRENT_PROCESSING: 2, // Max simultaneous screenshot processing tasks (1-4)
}

// Session Processor Configuration
export const SESSION_PROCESSOR_CONFIG = {
  MAX_LLM_IMAGES_PER_SESSION: 6, // First + last + evenly sampled middle frames
  MAX_SESSION_PROCESSING_RETRIES: 2, // Retry full session pipeline on transient failures
}

// Context Capture Configuration
export const CONTEXT_CAPTURE_CONFIG = {
  ENABLED: false, // Disabled by default (requires permissions)
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
