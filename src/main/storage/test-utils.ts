import * as fs from 'fs'
import type { StoredActivity } from './types'

/**
 * Creates a 384-element vector padded with zeros.
 * The leading values can be specified; the rest default to 0.
 */
export function v(...vals: number[]): number[] {
  return Object.assign(new Array(384).fill(0), vals)
}

export const deleteDbFiles = (dbPath: string): void => {
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = dbPath + suffix
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}

export const createStoredActivity = (
  overrides: Partial<StoredActivity> & { id: string },
): StoredActivity => ({
  id: overrides.id,
  startTimestamp: overrides.startTimestamp ?? Date.now(),
  endTimestamp: overrides.endTimestamp ?? Date.now() + 60000,
  appName: overrides.appName ?? 'TestApp',
  windowTitle: overrides.windowTitle ?? 'Test Window',
  tld: overrides.tld ?? null,
  summary: overrides.summary ?? 'Test activity summary',
  summaryModel: overrides.summaryModel ?? '',
  summaryMode: overrides.summaryMode ?? '',
  summaryReason: overrides.summaryReason ?? '',
  summaryFailureDetail: overrides.summaryFailureDetail ?? '',
  ocrText: overrides.ocrText ?? 'Sample OCR text',
  vector: overrides.vector ?? v(0.1, 0.2, 0.3),
})
