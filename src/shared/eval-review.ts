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

/** One step of a recording script: what to do, and the activity it should produce. */
export interface RecordingScriptStep {
  instruction: string
  expect: {
    /** Accepted app names; `browser` matches any known browser. */
    app: string[]
    tld?: string
    /** Expected to be dropped (e.g. a <3s hop). */
    dropped?: true
    /** Target summary. Omitted on a dropped step or a heuristic `Viewed …` step. */
    summary?: string
    mustMention?: string[]
  }
}

/** A short scripted session; each step maps to one expected activity. */
export interface RecordingScript {
  id: string
  title: string
  /** Pipeline behaviours this script exercises. */
  targets: string[]
  /** State to set up before pressing Start. */
  setup: string
  steps: RecordingScriptStep[]
}

/** Whether a scripted recording produced the activities its script expects. */
export interface ScriptCheck {
  scriptId: string
  followed: boolean
  expected: number
  produced: number
  issues: string[]
}

/** A fixture loaded for review: the editable golden + the review video. */
export interface EvalFixtureLoad {
  name: string
  label: string
  goldenMd: string
  scriptId: string | null
  scriptCheck: ScriptCheck | null
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

/** A mined sighting, for the Tasks tab's list. */
export interface TaskSightingSummary {
  id: string
  title: string
  description: string
  apps: string[]
  activityIds: string[]
  detectedAt: number
  startedAt: number
  endedAt: number
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
