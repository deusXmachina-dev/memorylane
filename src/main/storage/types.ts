export interface StoredActivity {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
  summaryModel: string
  ocrText: string
  vector: number[]
}

/** Lightweight activity without heavy ocr_text and vector fields. */
export interface ActivitySummary {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  /** Computed at read (`tld || app_name`): website host for web work, app name otherwise. Never stored. */
  identity: string
  summary: string
}

export type { ActivityDetail } from '@types'
