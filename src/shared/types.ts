import type { AppEditionConfig } from './edition'

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
    hwnd?: string // Stable window identity on Windows (native HWND as hex string)
    bundleId?: string
    url?: string // Browser tab URL (Chrome, Safari, Arc, etc.)
  }

  // App change-specific
  previousWindow?: {
    title: string
    processName: string
    hwnd?: string
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

export type LlmHealthState = 'not_configured' | 'unknown' | 'active' | 'failing'

export interface LlmHealthStatus {
  configured: boolean
  state: LlmHealthState
  consecutiveFailures: number
  lastError: string | null
  lastAttemptAt: number | null
}

export type SubscriptionPlan = 'explorer'

export type SubscriptionStatus = 'idle' | 'awaiting_checkout' | 'polling' | 'error'

export type EnterpriseActivationStatus =
  | 'idle'
  | 'inactive'
  | 'activating'
  | 'waiting_for_key'
  | 'activated'
  | 'error'

export interface SubscriptionUpdate {
  status: SubscriptionStatus
  error?: string | undefined
}

export interface AccessState {
  edition: AppEditionConfig['edition']
  isEnterpriseActivated: boolean
  customerSubscriptionStatus: SubscriptionStatus | null
  enterpriseActivationStatus: EnterpriseActivationStatus | null
  error: string | null
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

export interface DirectorySelectionResult {
  cancelled: boolean
  directoryPath?: string | undefined
  error?: string | undefined
}

export interface SettingsAPI {
  getKeyStatus: () => Promise<KeyStatus>
  saveApiKey: (key: string) => Promise<SaveResult>
  deleteApiKey: () => Promise<SaveResult>
  close: () => void
  openExternal: (url: string) => Promise<void>
  addToClaude: () => Promise<boolean>
  addToCursor: () => Promise<boolean>
  addToClaudeCode: () => Promise<boolean>
}

export interface MainWindowStatus {
  capturing: boolean
  captureHotkeyLabel: string
}

export interface ObservationState {
  phase: 'idle' | 'running'
  endsAt: number | null
  appsCount: number
  urlsCount: number
  lastRun?: {
    appsAdded: number
    urlsAdded: number
    apps: string[]
    urls: string[]
    at: number
  }
}

export interface MainWindowStats {
  activityCount: number
  dbSize: number
  dateRange: { oldest: number | null; newest: number | null }
  apiUsage: { requestCount: number; totalCost: number } | null
  totalRepetitiveHoursPerWeek: number | null
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
  captureHotkeyAccelerator: string
  databaseExportDirectory: string
  excludePrivateBrowsing: boolean
  excludedApps: string[]
  excludedWindowTitlePatterns: string[]
  excludedUrlPatterns: string[]
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
  patternDetectionEnabled: boolean
  uploadDetailLevel: 'off' | 'summary' | 'detailed'
}

export interface InstalledApp {
  displayName: string
  matchToken: string
}

export interface SeenDomain {
  tld: string
  count: number
  lastSeenAt: number
}

export type McpEntryStatus = 'not-registered' | 'current' | 'stale'
export type McpRegistrationStatus = Record<string, McpEntryStatus>

export type SemanticPipelineMode = 'auto' | 'video' | 'image'

export type UpdateState = 'idle' | 'downloading' | 'ready'

export interface PatternInfo {
  id: string
  name: string
  description: string
  apps: string[]
  automationIdea: string
  createdAt: number
  rejectedAt: number | null
  promptCopiedAt: number | null
  approvedAt: number | null
  completedAt: number | null
  sightingCount: number
  lastSeenAt: number | null
  lastConfidence: number | null
  estimatedHoursPerWeek: number | null
}

export interface MainWindowAPI {
  getEditionConfig: () => Promise<AppEditionConfig>
  getAccessState: () => Promise<AccessState>
  refreshAccessState: () => Promise<AccessState>
  onAccessStateChanged: (callback: (state: AccessState) => void) => void
  activateEnterpriseLicense: (activationKey: string) => Promise<SaveResult>
  getStatus: () => Promise<MainWindowStatus>
  toggleCapture: () => Promise<MainWindowStatus>
  onStatusChanged: (callback: (status: MainWindowStatus) => void) => void
  // Settings methods (merged from settingsAPI)
  getKeyStatus: () => Promise<KeyStatus>
  saveApiKey: (key: string) => Promise<SaveResult>
  deleteApiKey: () => Promise<SaveResult>
  addToClaude: () => Promise<boolean>
  addToCursor: () => Promise<boolean>
  addToClaudeCode: () => Promise<boolean>
  getMcpStatus: () => Promise<McpRegistrationStatus>
  // Custom endpoint
  getCustomEndpoint: () => Promise<CustomEndpointStatus>
  saveCustomEndpoint: (config: CustomEndpointConfig) => Promise<SaveResult>
  deleteCustomEndpoint: () => Promise<SaveResult>
  getLlmHealth: () => Promise<LlmHealthStatus>
  testLlmConnection: () => Promise<void>
  // Subscription
  startCheckout: (plan: SubscriptionPlan) => Promise<void>
  openSubscriptionPortal: () => Promise<void>
  getSubscriptionStatus: () => Promise<SubscriptionStatus>
  onSubscriptionUpdate: (callback: (update: SubscriptionUpdate) => void) => void
  // Privacy metadata
  listInstalledApps: () => Promise<InstalledApp[]>
  listSeenDomains: () => Promise<SeenDomain[]>
  // Capture settings
  getCaptureSettings: () => Promise<CaptureSettings>
  saveCaptureSettings: (settings: Partial<CaptureSettings>) => Promise<SaveResult>
  resetCaptureSettings: () => Promise<SaveResult>
  // Patterns
  getPatterns: () => Promise<PatternInfo[]>
  approvePattern: (id: string) => Promise<SaveResult>
  rejectPattern: (id: string) => Promise<SaveResult>
  completePattern: (id: string) => Promise<SaveResult>
  uncompletePattern: (id: string) => Promise<SaveResult>
  markPatternPromptCopied: (id: string) => Promise<SaveResult>
  // Theme
  getTheme: () => Promise<'dark' | 'light'>
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => void
  // Stats
  getStats: () => Promise<MainWindowStats>
  chooseDatabaseExportDirectory: (initialPath?: string) => Promise<DirectorySelectionResult>
  // Database export
  exportDatabaseZip: () => Promise<DatabaseExportResult>
  syncDatabaseToRemote: () => Promise<{ success: boolean; error?: string }>
  // Updater
  getUpdateState: () => Promise<UpdateState>
  onUpdateStateChanged: (callback: (state: UpdateState) => void) => void
  installUpdate: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  // Observation (build exclusion list from live activity)
  startObservation: (durationMs: number) => Promise<ObservationState>
  stopObservation: () => Promise<ObservationState>
  getObservationState: () => Promise<ObservationState>
  onObservationUpdate: (callback: (state: ObservationState) => void) => () => void
}
