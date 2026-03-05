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

  // Keyboard-specific: window context during typing session
  windowTitle?: string

  // Window/app context
  activeWindow?: {
    title: string
    processName: string
    bundleId?: string
    url?: string // Browser tab URL (Chrome, Safari, Arc, etc.)
  }

  // App change-specific
  previousWindow?: {
    title: string
    processName: string
    bundleId?: string
    url?: string
  }
}

export interface EventWindow {
  id: string
  startTimestamp: number
  endTimestamp: number
  events: InteractionContext[]
  closedBy: 'gap' | 'app_change' | 'max_duration' | 'flush'
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

export interface SlackIntegrationConfig {
  enabled: boolean
  ownerUserId: string
  watchedChannelIds: string
  pollIntervalMs: number
  allwaysApprove: boolean
  botToken?: string | undefined
}

export interface SlackIntegrationStatus {
  enabled: boolean
  running: boolean
  hasBotToken: boolean
  maskedBotToken: string | null
  ownerUserId: string
  watchedChannelIds: string
  pollIntervalMs: number
  allwaysApprove: boolean
  lastError: string | null
}

export type SubscriptionPlan = 'standard' | 'pro'

export type SubscriptionStatus = 'idle' | 'awaiting_checkout' | 'polling' | 'error'

export interface SubscriptionUpdate {
  status: SubscriptionStatus
  error?: string | undefined
}

export interface SaveResult {
  success: boolean
  error?: string | undefined
}

export interface DatabaseExportResult {
  success: boolean
  cancelled?: boolean | undefined
  outputPath?: string | undefined
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
  activityCount: number
  dbSize: number
  dateRange: { oldest: number | null; newest: number | null }
  apiUsage: { requestCount: number; totalCost: number } | null
}

export interface CaptureSettings {
  autoStartEnabled: boolean
  visualThreshold: number
  typingDebounceMs: number
  scrollDebounceMs: number
  clickDebounceMs: number
  minActivityDurationMs: number
  maxActivityDurationMs: number
  maxScreenshotsForLlm: number
  semanticRequestTimeoutMs: number
  semanticPipelineMode: SemanticPipelineMode
}

export type SemanticPipelineMode = 'auto' | 'video' | 'image'

export type UpdateState = 'idle' | 'downloading' | 'ready'

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
  // Slack integration
  getSlackSettings: () => Promise<SlackIntegrationStatus>
  saveSlackSettings: (config: SlackIntegrationConfig) => Promise<SaveResult>
  resetSlackSettings: () => Promise<SaveResult>
  // Subscription
  startCheckout: (plan: SubscriptionPlan) => Promise<void>
  openSubscriptionPortal: () => Promise<void>
  getSubscriptionStatus: () => Promise<SubscriptionStatus>
  onSubscriptionUpdate: (callback: (update: SubscriptionUpdate) => void) => void
  // Capture settings
  getCaptureSettings: () => Promise<CaptureSettings>
  saveCaptureSettings: (settings: Partial<CaptureSettings>) => Promise<SaveResult>
  resetCaptureSettings: () => Promise<SaveResult>
  // Stats
  getStats: () => Promise<MainWindowStats>
  // Database export
  exportDatabaseZip: () => Promise<DatabaseExportResult>
  // Updater
  getUpdateState: () => Promise<UpdateState>
  onUpdateStateChanged: (callback: (state: UpdateState) => void) => void
  installUpdate: () => Promise<void>
}
