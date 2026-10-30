// summaryModel value stamped on activities summarized by the no-LLM heuristic
// path, so they're distinguishable from LLM output ('') and real models.
export const HEURISTIC_VIEWED_MODEL = 'heuristic:viewed'

/** Passive views embed their OCR'd screen, not the "Viewed X" label, so they
 * stay findable by what was on screen. */
export function embeddingText(a: {
  summary: string
  summaryModel: string
  ocrText: string
}): string {
  return a.summaryModel === HEURISTIC_VIEWED_MODEL ? a.ocrText || a.summary : a.summary || a.ocrText
}
