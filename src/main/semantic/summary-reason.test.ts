import { describe, it, expect } from 'vitest'
import { deriveSummaryOutcome } from './summary-reason'
import type { SemanticAttempt, SemanticRunDiagnostics } from './types'

function diagnostics(overrides: Partial<SemanticRunDiagnostics>): SemanticRunDiagnostics {
  return {
    activityId: 'a1',
    pipelinePreference: 'auto',
    promptChars: 0,
    chosenMode: null,
    chosenModel: null,
    fallbackReason: null,
    attempts: [],
    selectedSnapshotPaths: [],
    videoSizeBytes: null,
    videoMimeType: null,
    ...overrides,
  }
}

const videoFail = (error: string): SemanticAttempt => ({
  mode: 'video',
  model: 'google/gemini-2.5-flash',
  durationMs: 1,
  success: false,
  error,
})

describe('deriveSummaryOutcome', () => {
  it('marks a successful video summary as mode=video, reason=video', () => {
    expect(deriveSummaryOutcome(diagnostics({ chosenMode: 'video' }))).toEqual({
      mode: 'video',
      reason: 'video',
      failureDetail: '',
    })
  })

  it('classifies a video timeout fallback and keeps the raw detail', () => {
    const out = deriveSummaryOutcome(
      diagnostics({
        chosenMode: 'snapshot',
        fallbackReason: 'all video models failed',
        attempts: [videoFail('semantic model request timed out after 120000ms')],
      }),
    )
    expect(out.mode).toBe('snapshot')
    expect(out.reason).toBe('video_timeout')
    expect(out.failureDetail).toBe('semantic model request timed out after 120000ms')
  })

  it('classifies a video HTTP error (e.g. decommissioned model 404)', () => {
    const out = deriveSummaryOutcome(
      diagnostics({
        chosenMode: 'snapshot',
        fallbackReason: 'all video models failed',
        attempts: [videoFail('404 Not Found provider_message=The free Molmo2 8B period has ended')],
      }),
    )
    expect(out.reason).toBe('video_http_error')
  })

  it('classifies an empty video summary', () => {
    const out = deriveSummaryOutcome(
      diagnostics({
        chosenMode: 'snapshot',
        fallbackReason: 'all video models failed',
        attempts: [videoFail('empty summary')],
      }),
    )
    expect(out.reason).toBe('video_empty')
  })

  it('uses the first video failure as the deciding cause', () => {
    const out = deriveSummaryOutcome(
      diagnostics({
        chosenMode: 'snapshot',
        fallbackReason: 'all video models failed',
        attempts: [
          videoFail('semantic model request timed out after 120000ms'),
          videoFail('404 Not Found'),
        ],
      }),
    )
    expect(out.reason).toBe('video_timeout')
  })

  it('maps oversize / missing fallbacks (no video attempt) from fallbackReason', () => {
    expect(
      deriveSummaryOutcome(
        diagnostics({
          chosenMode: 'snapshot',
          fallbackReason: 'video exceeds configured size limit',
        }),
      ).reason,
    ).toBe('video_oversize')
    expect(
      deriveSummaryOutcome(
        diagnostics({ chosenMode: 'snapshot', fallbackReason: 'video file missing' }),
      ).reason,
    ).toBe('video_missing')
    expect(
      deriveSummaryOutcome(
        diagnostics({ chosenMode: 'snapshot', fallbackReason: 'video unavailable' }),
      ).reason,
    ).toBe('video_unavailable')
  })

  it('maps not-configured with no produced summary', () => {
    const out = deriveSummaryOutcome(
      diagnostics({ chosenMode: null, fallbackReason: 'semantic service is not configured' }),
    )
    expect(out).toEqual({ mode: '', reason: 'not_configured', failureDetail: '' })
  })
})
