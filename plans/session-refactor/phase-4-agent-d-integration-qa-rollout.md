# Phase 4 - Agent D: Integration, QA, and Rollout

## Objective

Validate that session-based capture and processing work reliably end-to-end,
with no schema/API regressions and acceptable cost/performance.

## Primary Files

- `src/main/index.ts` (wiring validation)
- `src/main/recorder/*` (session lifecycle integration)
- `src/main/processor/*` (session processing integration)
- `src/main/mcp/*` (instruction behavior validation)
- `README.md` / `RELEASE_NOTES.md` (operational notes if needed)
- test files under existing test structure

## Implementation Scope

1. **End-to-End Test Matrix**
   - Session ends by app switch
   - Session ends by max duration
   - Session ends by stop recording
   - No visual change during session (initial + final only)
   - Frequent changes with image cap enforcement

2. **Data Integrity Checks**
   - Exactly one DB row per ended session
   - `text` includes all OCR segments in order
   - `summary` present and coherent
   - `appName` and timestamp semantics match contract

3. **MCP Behavior Checks**
   - Activity questions answered from summaries
   - Exact recall questions use OCR only when needed
   - No regressions in `search_context`, `browse_timeline`, `get_event_details`

4. **Performance and Cost Checks**
   - Validate LLM image cap is respected
   - Validate processing latency per session
   - Validate memory/disk behavior for long sessions

5. **Failure and Recovery**
   - OCR failure path still stores useful event data
   - LLM failure path uses fallback summary strategy
   - No screenshot leaks after recoverable failures

## Deliverables

- Integration test coverage for new session lifecycle.
- QA checklist with pass/fail evidence.
- Rollout notes including config defaults and operational guardrails.

## Acceptance Criteria

- All phase-level acceptance criteria from Agents A-C are satisfied in E2E.
- No required database migration.
- No breaking changes in MCP API surface.
- Lint/tests pass for modified scope.

## Risks and Mitigations

- **Risk:** Cross-module contract mismatch (recorder -> processor)  
  **Mitigation:** Add typed interface tests and fixture-based integration tests.
- **Risk:** Session-level processing delays user recall freshness  
  **Mitigation:** Validate max session duration default and tune if needed.
- **Risk:** Increased OCR text size degrades FTS quality  
  **Mitigation:** Validate search quality on realistic sample sessions.

## Release Recommendation

- Ship behind a temporary config gate if feasible.
- Observe metrics for session size, processing latency, and summary quality.
- Remove gate after stable behavior is confirmed.
