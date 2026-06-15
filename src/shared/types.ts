import type { AppEditionConfig } from './edition'

export interface InteractionContext {
  // 'presence' is a synthetic heartbeat emitted while the user is at the machine
  // but not providing input (reading), so a no-input view keeps its event window
  // alive instead of dying at the idle gap. It is not a real interaction: it is a
  // bare event (no window context) and never counts toward "active" engagement.
  type: 'click' | 'keyboard' | 'scroll' | 'app_change' | 'presence'
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

export type Vendor = 'openrouter' | 'google' | 'openai-compatible'

export const VENDORS: readonly Vendor[] = ['openrouter', 'google', 'openai-compatible'] as const

export interface VendorCredentials {
  apiKey: string
  /** Optional override of the SDK default base URL. Required for openai-compatible. */
  baseURL?: string
  /** Google Vertex managed mode only: GCP project id. */
  project?: string
  /** Google Vertex managed mode only: GCP region (e.g. us-central1). */
  location?: string
}

export interface VendorStatus {
  hasKey: boolean
  source: 'stored' | 'managed' | 'env' | 'none'
  maskedKey: string | null
  baseURL: string | null
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
  | 'awaiting_consent'
  | 'waiting_for_key'
  | 'activated'
  | 'error'

export interface PendingConsent {
  title: string
  contentType: 'application/pdf'
  bytesBase64: string
}

export type ConsentOutcome = 'accepted' | 'declined'

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

export interface DatabaseImportResult {
  success: boolean
  cancelled?: boolean | undefined
  error?: string | undefined
}

export interface DirectorySelectionResult {
  cancelled: boolean
  directoryPath?: string | undefined
  error?: string | undefined
}

export interface SettingsAPI {
  getCredentialStatuses: () => Promise<Record<Vendor, VendorStatus>>
  saveCredentials: (vendor: Vendor, creds: VendorCredentials) => Promise<SaveResult>
  deleteCredentials: (vendor: Vendor) => Promise<SaveResult>
  setActiveVendor: (vendor: Vendor) => Promise<SaveResult>
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

export type { ActivityDetail } from '../main/storage/types'

export interface ActivityDigest {
  totalCount: number
  dateRange: { oldest: number | null; newest: number | null }
  topApps: { appName: string; count: number }[]
  topTlds: { tld: string; count: number; lastSeenAt: number }[]
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
  activeVendor: Vendor
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
  modelsByVendor: Partial<Record<Vendor, VendorModelSelection>>
  patternDetectionEnabled: boolean
  uploadDetailLevel: 'off' | 'summary' | 'detailed'
}

export interface VendorModelSelection {
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
  semanticPipelineMode: SemanticPipelineMode
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

export interface UpdateInfo {
  state: UpdateState
  version: string | null
}

export type PermissionKind = 'accessibility' | 'screenRecording'
export type PermissionState = 'granted' | 'denied' | 'unknown'
export interface PermissionStatus {
  accessibility: PermissionState
  screenRecording: PermissionState
}

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

export interface PatternActivityRef {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
}

export interface PatternSightingInfo {
  id: string
  detectedAt: number
  evidence: string
  confidence: number
  durationEstimateMin: number | null
  activities: PatternActivityRef[]
}

export interface PatternDetailInfo {
  pattern: PatternInfo
  sightings: PatternSightingInfo[]
}

// ---------------------------------------------------------------------------
// Task mining: sightings (carved in stone) + clusters (derived process candidates)
// ---------------------------------------------------------------------------

/** A single mined task instance. Wall-clock span = endedAt - startedAt. */
export interface SightingInfo {
  id: string
  title: string
  description: string
  apps: string[]
  activityIds: string[]
  startedAt: number
  endedAt: number
  interactionMin: number
  confidence: number
  detectedAt: number
}

/** A process candidate: a group of sightings, with computed ROI stats. */
export interface ClusterInfo {
  id: string
  label: string
  description: string
  apps: string[]
  sightingCount: number
  distinctDays: number
  totalInteractionMin: number
  firstSeenAt: number
  lastSeenAt: number
  perWeek: number | null
}

export interface ClusterDetailInfo {
  cluster: ClusterInfo
  /** Member sightings, each with its hydrated activity timeline for recall. */
  sightings: (SightingInfo & { activities: PatternActivityRef[] })[]
}

export interface MainWindowAPI {
  getEditionConfig: () => Promise<AppEditionConfig>
  getAccessState: () => Promise<AccessState>
  refreshAccessState: () => Promise<AccessState>
  onAccessStateChanged: (callback: (state: AccessState) => void) => () => void
  activateEnterpriseLicense: (activationCode: string) => Promise<SaveResult>
  getPendingConsent: () => Promise<PendingConsent | null>
  submitConsentDecision: (outcome: ConsentOutcome) => Promise<SaveResult>
  getStatus: () => Promise<MainWindowStatus>
  toggleCapture: () => Promise<MainWindowStatus>
  onStatusChanged: (callback: (status: MainWindowStatus) => void) => () => void
  // Settings methods (merged from settingsAPI)
  getCredentialStatuses: () => Promise<Record<Vendor, VendorStatus>>
  saveCredentials: (vendor: Vendor, creds: VendorCredentials) => Promise<SaveResult>
  deleteCredentials: (vendor: Vendor) => Promise<SaveResult>
  setActiveVendor: (vendor: Vendor) => Promise<SaveResult>
  addToClaude: () => Promise<boolean>
  addToCursor: () => Promise<boolean>
  addToClaudeCode: () => Promise<boolean>
  getMcpStatus: () => Promise<McpRegistrationStatus>
  getLlmHealth: () => Promise<LlmHealthStatus>
  testLlmConnection: () => Promise<void>
  // Subscription
  startCheckout: (plan: SubscriptionPlan) => Promise<void>
  openSubscriptionPortal: () => Promise<void>
  getSubscriptionStatus: () => Promise<SubscriptionStatus>
  onSubscriptionUpdate: (callback: (update: SubscriptionUpdate) => void) => () => void
  // Privacy metadata
  listInstalledApps: () => Promise<InstalledApp[]>
  listSeenDomains: () => Promise<SeenDomain[]>
  // Capture settings
  getCaptureSettings: () => Promise<CaptureSettings>
  saveCaptureSettings: (settings: Partial<CaptureSettings>) => Promise<SaveResult>
  resetCaptureSettings: () => Promise<SaveResult>
  // Patterns
  getPatterns: () => Promise<PatternInfo[]>
  getPatternDetail: (id: string) => Promise<PatternDetailInfo | null>
  approvePattern: (id: string) => Promise<SaveResult>
  rejectPattern: (id: string) => Promise<SaveResult>
  completePattern: (id: string) => Promise<SaveResult>
  uncompletePattern: (id: string) => Promise<SaveResult>
  markPatternPromptCopied: (id: string) => Promise<SaveResult>
  // Theme
  getTheme: () => Promise<'dark' | 'light'>
  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => void
  // Activities
  listRecentActivities: (limit: number, offset?: number) => Promise<ActivityDetail[]>
  getActivityDigest: () => Promise<ActivityDigest>
  // Stats
  getStats: () => Promise<MainWindowStats>
  chooseDatabaseExportDirectory: (initialPath?: string) => Promise<DirectorySelectionResult>
  setDatabaseExportDirectory: (directoryPath: string) => Promise<SaveResult>
  // Database export
  exportDatabaseZip: () => Promise<DatabaseExportResult>
  importDatabase: () => Promise<DatabaseImportResult>
  syncDatabaseToRemote: () => Promise<{ success: boolean; error?: string }>
  purgeDatabase: (confirmation: string) => Promise<{ success: boolean; error?: string }>
  // Updater
  getUpdateInfo: () => Promise<UpdateInfo>
  onUpdateStateChanged: (callback: (info: UpdateInfo) => void) => () => void
  installUpdate: () => Promise<void>
  openExternal: (url: string) => Promise<void>
  // Observation (build exclusion list from live activity)
  startObservation: (durationMs: number) => Promise<ObservationState>
  stopObservation: () => Promise<ObservationState>
  getObservationState: () => Promise<ObservationState>
  onObservationUpdate: (callback: (state: ObservationState) => void) => () => void
  // Permissions
  getPermissionStatus: () => Promise<PermissionStatus>
  requestPermission: (kind: PermissionKind) => Promise<PermissionStatus>
  openPermissionSettings: (kind: PermissionKind) => Promise<void>
  onPermissionStatusChanged: (callback: (status: PermissionStatus) => void) => () => void
  // App lifecycle
  restartApp: () => Promise<void>
  // Host platform (set at preload time; never changes mid-session)
  platform: NodeJS.Platform
}
