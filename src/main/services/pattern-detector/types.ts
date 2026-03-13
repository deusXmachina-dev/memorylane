import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PatternDetectorConfig {
  model: string
  lookbackDays: number
}

export const DEFAULT_DETECTOR_CONFIG: PatternDetectorConfig = {
  model: PATTERN_DETECTION_CONFIG.MODEL,
  lookbackDays: PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Candidate {
  name: string
  description: string
  apps: string[]
  activity_ids: string[]
  confidence: number
  automation_idea?: string
  evidence?: string
  existing_pattern_id?: string
}

export interface VerifiedFinding {
  verdict: 'new' | 'sighting'
  name: string
  description: string
  apps: string[]
  automation_idea: string
  duration_estimate_min: number | null
  confidence: number
  evidence: string
  existing_pattern_id?: string
  activity_ids: string[]
  updates?: {
    name?: string
    description?: string
    apps?: string[]
    automation_idea?: string
  }
}

export interface DetectionRunResult {
  runId: string
  newPatterns: number
  updatedPatterns: number
  totalFindings: number
  candidatesFromScan: number
  candidatesVerified: number
  candidatesRejected: number
  tokenUsage: {
    scan: { input: number; output: number }
    verify: { input: number; output: number }
    total: { input: number; output: number }
  }
}

export type ProgressCallback = (message: string) => void
