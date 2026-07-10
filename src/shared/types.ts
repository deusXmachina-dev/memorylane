import type { AppEditionConfig } from './edition'
import type {
  EvalFixtureLoad,
  EvalFixtureSummary,
  EvalPromoteSummary,
  EvalRecordingStatus,
  TaskFixtureLoad,
  TaskFixtureSummary,
  TaskGoldenDraft,
  TaskSightingSummary,
} from './eval-review'

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
  /**
   * When capture is on a timed pause, the epoch-ms deadline at which it
   * auto-resumes; null when not paused. Drives the renderer countdown.
   */
  pausedUntilMs: number | null
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
  excludedUrlPatterns: string[]
  urlMatchSchemaVersion?: number
  appMatchSchemaVersion?: number
  modelDefaultsVersion?: number
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
  /** Identity the matcher keys on: bundle id (macOS) / exe name (Windows). */
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

/**
 * Cluster classification from the review LLM call. '' = not yet judged.
 * Advisory display metadata only — never used to filter or roll up until the
 * cluster-review eval's false-eliminable rate is green.
 */
export const CLUSTER_KINDS = ['procedure', 'monitoring', 'ambient', 'dev-loop', 'judgment'] as const
export type ClusterKind = (typeof CLUSTER_KINDS)[number] | ''

/** A recurring task cluster with stats derived from its member sightings. */
export type RecurrenceUnit = 'day' | 'week'

/** One bar of the recurrence histogram: bucket start (epoch ms) + sighting count. */
export interface RecurrenceBucket {
  start: number
  count: number
}

export interface ClusterInfo {
  id: string
  /** Resolved for display: cluster label, or the most common member title. */
  title: string
  description: string
  apps: string[]
  timesSeen: number
  /** Estimated runs per week: timesSeen ÷ observedDays × 7; 0 when nothing observed. */
  timesPerWeek: number
  /** Distinct local days with captured activity in the stats window (frequency denominator). */
  observedDays: number
  /** Mean per-run active time (union of cited-activity intervals), in minutes. */
  avgActiveMin: number
  /** Mean per-run wall-clock span (first activity start → last end), in minutes. */
  avgSpanMin: number
  /** Mean per-run inactive time inside the span: max(0, span − active), in minutes. */
  avgIdleMin: number
  /** Active minutes summed across all kept sightings (sightings are pruned at 90 days). */
  totalActiveMin: number
  kind: ClusterKind
  /** Consolidated "Replace with" recommendation; set only for 'procedure' clusters. */
  mechanism: string
  firstSeenAt: number | null
  lastSeenAt: number | null
  /** Recurrence histogram, oldest→newest — drives the sparkline and bars. */
  recurrence: RecurrenceBucket[]
  /** Whether each recurrence bucket is a day or a week. */
  recurrenceUnit: RecurrenceUnit
}

/** A single occurrence of a cluster (one mined sighting). */
export interface ClusterSightingInfo {
  id: string
  title: string
  /** The object this run acted on; empty when the scan named none. */
  subject: string
  description: string
  apps: string[]
  /** Wall-clock span: first activity start → last activity end. */
  startedAt: number
  endedAt: number
  /** Active time (union of cited-activity intervals), in minutes. */
  activeMin: number
  /** Underlying activity ids — handle for the "Copy prompt for Claude" flow. */
  activityIds: string[]
}

export interface ClusterDetailInfo {
  /** Member sightings, newest-first. */
  sightings: ClusterSightingInfo[]
}

/** getClusters payload: visible clusters plus how many the noise floor hid. */
export interface ClustersView {
  clusters: ClusterInfo[]
  /** Clusters hidden as one-off noise (seen once, below the total-time floor). */
  hiddenCount: number
}

/** The tenant's centrally-synced capture blacklist, surfaced read-only in the
 * exclusions UI so users can see what their organization enforces. */
export interface ManagedExclusions {
  apps: string[]
  urlPatterns: string[]
}

/** Result of the dev-only wipe-and-re-mine action. */
export interface WipeAndRemineResult {
  success: boolean
  error?: string
  summary?: {
    daysMined: number
    daysSkipped: number
    daysFailed: number
    /** Set when the re-mine did not run (no provider configured, or busy). */
    skipped?: 'no-provider' | 'busy'
  }
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
  pauseCapture: (durationMs: number) => Promise<MainWindowStatus>
  resumeCapture: () => Promise<MainWindowStatus>
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
  // Patterns (task clusters)
  getClusters: () => Promise<ClustersView>
  getClusterDetail: (id: string) => Promise<ClusterDetailInfo | null>
  // Dev-only: wipe all mined sightings/clusters and re-mine from scratch
  wipeAndRemineTasks: () => Promise<WipeAndRemineResult>
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
  exportLogsZip: () => Promise<DatabaseExportResult>
  importDatabase: () => Promise<DatabaseImportResult>
  syncDatabaseToRemote: () => Promise<{ success: boolean; error?: string }>
  syncLogsToRemote: () => Promise<{ success: boolean; error?: string }>
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
  // Org-provided (centrally-synced) capture exclusions — read-only in the app.
  getManagedExclusions: () => Promise<ManagedExclusions>
  onManagedExclusionsUpdate: (callback: (managed: ManagedExclusions) => void) => () => void
  // Permissions
  getPermissionStatus: () => Promise<PermissionStatus>
  requestPermission: (kind: PermissionKind) => Promise<PermissionStatus>
  onPermissionStatusChanged: (callback: (status: PermissionStatus) => void) => () => void
  // App lifecycle
  restartApp: () => Promise<void>
  // Eval recorder + fixture review (Developer mode)
  evalStartRecording: (
    name: string,
  ) => Promise<{ success: boolean; status?: EvalRecordingStatus; error?: string }>
  evalStopRecording: () => Promise<{
    success: boolean
    fixture?: EvalPromoteSummary
    error?: string
  }>
  evalRecordingStatus: () => Promise<EvalRecordingStatus>
  evalListFixtures: () => Promise<EvalFixtureSummary[]>
  evalLoadFixture: (name: string) => Promise<EvalFixtureLoad | null>
  evalSaveGolden: (name: string, markdown: string) => Promise<{ success: boolean; error?: string }>
  evalDeleteFixture: (name: string) => Promise<{ success: boolean; error?: string }>
  evalExportFixture: (name: string) => Promise<{ success: boolean; path?: string; error?: string }>
  // Task-mining goldens (Developer → Tasks tab)
  evalListTaskSightings: () => Promise<TaskSightingSummary[]>
  evalPreviewTaskGolden: (
    sightingId: string,
    beforeMin: number,
    afterMin: number,
  ) => Promise<TaskGoldenDraft | null>
  evalPromoteTaskSighting: (
    sightingId: string,
    opts: { beforeMin: number; afterMin: number; goldenMd: string; name: string },
  ) => Promise<{ success: boolean; fixture?: TaskFixtureSummary; error?: string }>
  evalListTaskFixtures: () => Promise<TaskFixtureSummary[]>
  evalLoadTaskFixture: (name: string) => Promise<TaskFixtureLoad | null>
  evalSaveTaskGolden: (
    name: string,
    markdown: string,
  ) => Promise<{ success: boolean; error?: string }>
  evalDeleteTaskFixture: (name: string) => Promise<{ success: boolean; error?: string }>
  evalExportTaskFixture: (
    name: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>
  // Host platform (set at preload time; never changes mid-session)
  platform: NodeJS.Platform
}
