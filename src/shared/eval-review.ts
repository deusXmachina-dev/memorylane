/**
 * Renderer-facing types for the in-app eval recorder + golden review (Developer
 * mode). Shared between the main-process IPC handlers and the React UI. Kept free
 * of any `src/main` imports so the renderer's tsconfig can compile it.
 */

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

/** A fixture loaded for review: the editable golden + the review video. */
export interface EvalFixtureLoad {
  name: string
  label: string
  goldenMd: string
  /** `mlmedia://` URL streaming `session.mp4` off disk (seekable), or null. */
  videoUrl: string | null
}

/** Result of stopping a recording (the freshly promoted fixture). */
export interface EvalPromoteSummary {
  name: string
  frameCount: number
  eventWindowCount: number
  hasVideo: boolean
}
