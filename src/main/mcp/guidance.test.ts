import { describe, it, expect } from 'vitest'
import { SERVER_INSTRUCTIONS } from './server'
import {
  SEARCH_CONTEXT_TOOL_NAME,
  BROWSE_TIMELINE_TOOL_NAME,
  GET_EVENT_DETAILS_TOOL_NAME,
  SEARCH_CONTEXT_DESCRIPTION,
  BROWSE_TIMELINE_DESCRIPTION,
  GET_EVENT_DETAILS_DESCRIPTION,
} from './tools'
import { buildRecentActivityPromptText, buildTimeReportPromptText } from './prompts'

describe('MCP guidance contract', () => {
  it('keeps the MCP API surface stable for tool names', () => {
    expect(SEARCH_CONTEXT_TOOL_NAME).toBe('search_context')
    expect(BROWSE_TIMELINE_TOOL_NAME).toBe('browse_timeline')
    expect(GET_EVENT_DETAILS_TOOL_NAME).toBe('get_event_details')
  })

  it('states summary-first and OCR-only-recall rules at server level', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/summaries are the source of truth/i)
    expect(SERVER_INSTRUCTIONS).toMatch(/ocr is for exact recall only/i)
    expect(SERVER_INSTRUCTIONS).toMatch(/never infer activity from ocr alone/i)
  })

  it('keeps tool descriptions aligned with summary-first behavior', () => {
    expect(SEARCH_CONTEXT_DESCRIPTION).toMatch(/summary-first/i)
    expect(SEARCH_CONTEXT_DESCRIPTION).toMatch(/exact strings/i)

    expect(BROWSE_TIMELINE_DESCRIPTION).toMatch(/compact summary line/i)
    expect(BROWSE_TIMELINE_DESCRIPTION).toMatch(/call get_event_details only/i)

    expect(GET_EVENT_DETAILS_DESCRIPTION).toMatch(/raw ocr text/i)
    expect(GET_EVENT_DETAILS_DESCRIPTION).toMatch(/not for inferring user activity/i)
  })

  it('keeps prompt templates aligned with activity-vs-recall guidance', () => {
    const recentActivityPrompt = buildRecentActivityPromptText('30')
    expect(recentActivityPrompt).toMatch(/summaries as the primary evidence/i)
    expect(recentActivityPrompt).toMatch(/only .* exact ocr text/i)
    expect(recentActivityPrompt).toMatch(/do not infer user activity from ocr alone/i)

    const timeReportPrompt = buildTimeReportPromptText('today')
    expect(timeReportPrompt).toMatch(/summaries as the source of truth/i)
    expect(timeReportPrompt).toMatch(/only when exact ocr text/i)
    expect(timeReportPrompt).toMatch(/never infer activity from ocr alone/i)
  })
})
