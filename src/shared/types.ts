export interface Screenshot {
  id: string // UUID
  filepath: string // Absolute path to PNG
  timestamp: number // Unix ms
  display: {
    id: number
    width: number
    height: number
  }
  trigger: CaptureReason // Why was this screenshot taken
}

export interface CaptureReason {
  type: 'timer' | 'baseline_change' | 'manual'
  confidence?: number // Visual change percentage (0-100) for baseline_change
  metadata?: Record<string, unknown>
}

export interface InteractionContext {
  type: 'click' | 'keyboard' | 'scroll' | 'app_change'
  timestamp: number
  displayId?: number // Electron Display.id of the screen where the interaction occurred

  // Click-specific
  clickPosition?: { x: number; y: number }

  // Keyboard-specific
  keyCount?: number // Number of keys pressed in typing session
  durationMs?: number // Duration of typing session in milliseconds

  // Scroll-specific
  scrollDirection?: 'vertical' | 'horizontal'
  scrollAmount?: number // Accumulated scroll delta

  // Window/app context
  activeWindow?: {
    title: string
    processName: string
    url?: string // Browser tab URL (Chrome, Safari, Arc, etc.)
  }

  // App change-specific
  previousWindow?: {
    title: string
    processName: string
    url?: string
  }
}

export type OnScreenshotCallback = (screenshot: Screenshot) => void

export interface ClassificationInput {
  startScreenshot: Screenshot
  endScreenshot?: Screenshot | undefined // Optional for single-image mode (app change)
  events: InteractionContext[]
}

export interface ClassificationResult {
  summary: string
  timestamp: number
}

export interface SearchFilters {
  startTime?: number | undefined // Unix ms
  endTime?: number | undefined // Unix ms
  appName?: string | undefined // Exact match
}

export interface SearchOptions extends SearchFilters {
  limit?: number | undefined
}

export interface KeyStatus {
  hasKey: boolean
  source: 'stored' | 'managed' | 'env' | 'none'
  maskedKey: string | null
}

export interface CustomEndpointConfig {
  serverURL: string // e.g. "http://localhost:11434/v1"
  model: string // e.g. "llama3.2-vision"
  apiKey?: string // optional - many local servers don't need one
}

export interface CustomEndpointStatus {
  enabled: boolean
  serverURL: string | null
  model: string | null
  hasApiKey: boolean
}

export type SubscriptionStatus = 'idle' | 'awaiting_checkout' | 'polling' | 'error'

export interface SubscriptionUpdate {
  status: SubscriptionStatus
  error?: string | undefined
}

export interface SaveResult {
  success: boolean
  error?: string | undefined
}

export interface SettingsAPI {
  getKeyStatus: () => Promise<KeyStatus>
  saveApiKey: (key: string) => Promise<SaveResult>
  deleteApiKey: () => Promise<SaveResult>
  close: () => void
  openExternal: (url: string) => Promise<void>
  addToClaude: () => Promise<void>
  addToCursor: () => Promise<void>
  addToClaudeCode: () => Promise<void>
}

export interface MainWindowStatus {
  capturing: boolean
}

export interface MainWindowStats {
  screenshotCount: number
  dbSize: number
  dateRange: { oldest: number | null; newest: number | null }
  apiUsage: { requestCount: number; totalCost: number } | null
}

export interface MainWindowAPI {
  getStatus: () => Promise<MainWindowStatus>
  toggleCapture: () => Promise<MainWindowStatus>
  onStatusChanged: (callback: (status: MainWindowStatus) => void) => void
  // Settings methods (merged from settingsAPI)
  getKeyStatus: () => Promise<KeyStatus>
  saveApiKey: (key: string) => Promise<SaveResult>
  deleteApiKey: () => Promise<SaveResult>
  addToClaude: () => Promise<void>
  addToCursor: () => Promise<void>
  addToClaudeCode: () => Promise<void>
  // Custom endpoint
  getCustomEndpoint: () => Promise<CustomEndpointStatus>
  saveCustomEndpoint: (config: CustomEndpointConfig) => Promise<SaveResult>
  deleteCustomEndpoint: () => Promise<SaveResult>
  // Subscription
  startCheckout: () => Promise<void>
  openSubscriptionPortal: () => Promise<void>
  getSubscriptionStatus: () => Promise<SubscriptionStatus>
  onSubscriptionUpdate: (callback: (update: SubscriptionUpdate) => void) => void
  // Stats
  getStats: () => Promise<MainWindowStats>
}
