/**
 * Renderer-facing types for the in-app eval recorder + golden review (Developer
 * mode). Shared between the main-process IPC handlers and the React UI. Kept free
 * of any `src/main` imports so the renderer's tsconfig can compile it.
 */

import type { EventWindow, InteractionContext } from './types'

export interface EvalRecordingStatus {
  recording: boolean
  name: string | null
  /** Epoch ms the current recording started, or null. */
  startedAt: number | null
}

/** One promoted fixture, for the Developer tab's list. */
export interface EvalFixtureSummary {
  name: string
  label: string
  capturedAt: string
  frameCount: number
  eventWindowCount: number
  appMix: string[]
  hasVideo: boolean
}

/** One captured interaction, formatted for display. Offsets anchor to the
 *  video/golden clock zero (session start). */
export interface EvalEvent {
  /** ms from session start (same zero as the video and golden mm:ss offsets). */
  offsetMs: number
  type: InteractionContext['type']
  /** Human text, identical to what the model's prompt timeline shows. */
  text: string
}

/** One EventWindow's interactions, grouped for the review timeline. */
export interface EvalEventWindow {
  startOffsetMs: number
  endOffsetMs: number
  closedBy: EventWindow['closedBy']
  /** App/window context for the window (e.g. "Chrome — github.com"), or null. */
  appLabel: string | null
  events: EvalEvent[]
}

/** A fixture loaded for review: the editable golden + the review video. */
export interface EvalFixtureLoad {
  name: string
  label: string
  goldenMd: string
  /** `mlmedia://` URL streaming `session.mp4` off disk (seekable), or null. */
  videoUrl: string | null
  /** Captured interaction events, window-grouped; `[]` when none on disk. */
  eventWindows: EvalEventWindow[]
}

/** Result of stopping a recording (the freshly promoted fixture). */
export interface EvalPromoteSummary {
  name: string
  frameCount: number
  eventWindowCount: number
  hasVideo: boolean
}

// ---------------------------------------------------------------------------
// Task-mining goldens (Developer → Tasks tab)
// ---------------------------------------------------------------------------

/** A legacy pattern-detection sighting, for the Tasks tab's list. */
export interface TaskSightingSummary {
  id: string
  patternName: string
  evidence: string
  apps: string[]
  activityIds: string[]
  detectedAt: number
  /** Earliest start / latest end of the sighting's activities, or null if unresolved. */
  startedAt: number | null
  endedAt: number | null
  activityCount: number
}

/** A golden.md draft + window preview for a sighting, before promotion. */
export interface TaskGoldenDraft {
  name: string
  goldenMd: string
  /** Activities that fall inside the noise window. */
  activityCount: number
  windowFrom: number
  windowTo: number
}

/** One promoted task golden, for the Tasks tab's list. */
export interface TaskFixtureSummary {
  name: string
  label: string
  sourceDay: string | null
  activityCount: number
  /** Epoch ms the fixture was written (manifest mtime). */
  createdAt: number
}

/** A task golden loaded for editing. */
export interface TaskFixtureLoad {
  name: string
  label: string
  goldenMd: string
}
