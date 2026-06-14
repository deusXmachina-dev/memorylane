import type { SemanticPromptBuilder } from '../semantic/types'
import { buildSemanticPrompt } from '../semantic/prompt'

/**
 * Named summarizer-prompt variants for A/B testing. `baseline` is the current
 * production `buildSemanticPrompt`. The judge scores a summary against the exact
 * `rules` of the variant that produced it, so add variants here (not by editing
 * the prod prompt) and the eval matrix can compare them on the same fixture.
 */
export interface PromptVariant {
  id: string
  description: string
  build: SemanticPromptBuilder
  /** Rubric source-of-truth: the rules the judge holds this variant's output to. */
  rules: string
}

// Mirrors the `## Rules` block in semantic/prompt.ts. Kept here verbatim so the
// judge evaluates against the same constraints the summarizer was given; update
// both together when the baseline prompt changes.
const BASELINE_RULES = `- Media is primary source. Timeline is secondary context for ordering/pacing.
- Answer "What was I working on?" - useful for recall, not a play-by-play.
- NEVER mention raw interactions (clicks, scrolling, key counts). Translate into meaningful actions.
- Be specific: name files, functions, errors, URLs, and UI elements visible in the provided media.
- Match verb intensity to evidence: browsing/reviewing -> "browsed/reviewed/checked"; light editing -> "tweaked/adjusted"; active work -> "implemented/debugged/refactored". Editing evidence = visible changed lines, new code, or diff markers.
- Do NOT exaggerate. Switching files/tabs = browsing, not editing. Opening a file/page = reviewing, not working on it.
- Distinguish preparation from completion. A form/dialog/compose window being filled is NOT evidence it was submitted. Without visible confirmation (success toast, redirect, confirmation screen) use preparatory verbs ("started", "drafted", "filled out") NOT completion verbs ("sent", "submitted", "created").
- Describe what changed over time: new code, different tabs/pages, updated content, navigation.
- If evidence is partial, hedge briefly instead of over-claiming.
- 40-100 words, 1-4 sentences, single paragraph, no bullet points. Low-activity sessions use the lower end.
- Start directly with the action or subject. NEVER start with "During this session", "In this session", "The user", or similar meta-phrases.`

const VARIANTS = new Map<string, PromptVariant>()

export function registerPromptVariant(variant: PromptVariant): void {
  VARIANTS.set(variant.id, variant)
}

export function getPromptVariant(id: string): PromptVariant {
  const variant = VARIANTS.get(id)
  if (!variant) {
    throw new Error(
      `Unknown prompt variant "${id}". Available: ${[...VARIANTS.keys()].join(', ') || '(none)'}`,
    )
  }
  return variant
}

export function listPromptVariants(): PromptVariant[] {
  return [...VARIANTS.values()]
}

registerPromptVariant({
  id: 'baseline',
  description: 'Current production buildSemanticPrompt',
  build: buildSemanticPrompt,
  rules: BASELINE_RULES,
})
