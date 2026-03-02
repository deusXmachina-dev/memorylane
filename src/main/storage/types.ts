export interface StoredActivity {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
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
  summary: string
}

/** Activity with window context but without heavy ocr_text and vector fields. */
export interface ActivityDetail {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
}
