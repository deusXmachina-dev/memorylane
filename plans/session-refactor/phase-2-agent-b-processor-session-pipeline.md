# Phase 2 - Agent B: Processor Session Pipeline

## Objective

Process one completed application session at a time and persist one consolidated event:

- OCR all session screenshots
- Concatenate OCR chronologically into `text`
- Run one LLM call for high-level session summary
- Persist one row with unchanged database schema

## Primary Files

- `src/main/processor/index.ts`
- `src/main/processor/semantic-classifier.ts`
- `src/main/processor/ocr.ts`
- `src/main/processor/storage.ts`
- `src/main/index.ts` (wiring from recorder session callback)
- `src/shared/types.ts` (session payload types)

## Implementation Scope

1. **Processor Entry Contract**
   - Add `processSession(...)` style entrypoint replacing direct per-screenshot dependence.
   - Queue and concurrency behavior should remain bounded.

2. **OCR Aggregation**
   - Run OCR for each screenshot in chronological order.
   - Concatenate OCR outputs into a single `text` string with deterministic delimiters.
   - Preserve ordering so later recall aligns with session timeline.

3. **Session-Level LLM Summary**
   - Replace pairwise/single-frame classification with session summarization prompt.
   - Input to LLM includes:
     - ordered session images
     - interaction events (clicks, keystrokes, scroll)
     - optional previous context only if needed for continuity
   - Output is one high-level `summary` for the whole session.

4. **Image Budgeting (Cost Guardrail)**
   - Add deterministic frame selection for LLM:
     - always include first and last
     - include evenly sampled middle frames up to cap
   - Keep all screenshots for OCR even if only sampled frames go to LLM.

5. **Storage and Embeddings**
   - Persist one `context_events` row per session using existing schema.
   - Use summary-first embedding source (fallback to OCR only if summary fails).
   - Set timestamp to session start for stable ordering.

6. **Cleanup**
   - Delete session screenshot files only after successful store path.
   - Define failure handling and retry behavior to avoid data loss.

## Deliverables

- New processor flow based on completed sessions.
- Consolidated `text` and session-level `summary`.
- Frame cap logic for LLM call cost control.
- Backward-compatible DB writes and search behavior.

## Acceptance Criteria

- One session in, one DB row out.
- `text` contains OCR from all screenshots in session order.
- `summary` describes session-level activity, not per-frame deltas.
- LLM image input count is bounded by configuration.
- Embedding/vector search continues to work without schema migration.

## Risks and Mitigations

- **Risk:** LLM prompt grows too large for long sessions  
  **Mitigation:** Hard image cap + compact event formatting + truncation strategy.
- **Risk:** OCR concat creates noisy large text blobs  
  **Mitigation:** Keep delimiters and optional section markers for recoverability.
- **Risk:** Session failures leave orphan screenshots  
  **Mitigation:** Add robust error paths and deferred cleanup.

## Handoff to Agent C and D

- Provide final summary style and quality expectations for MCP guidance updates.
- Provide event payload examples for end-to-end test fixtures.
