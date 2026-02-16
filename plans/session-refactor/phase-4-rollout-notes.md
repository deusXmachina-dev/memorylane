# Phase 4 Rollout Notes

Operational guidance for shipping session-based capture safely.

## Recommended Defaults

- `MAX_SESSION_DURATION_MS`: 10-15 minutes
- LLM frame cap: include first + last + evenly sampled middle frames
- Embedding source: summary-first, OCR fallback only
- Session end reasons: `app_switch`, `max_duration`, `stop`

## Guardrails

1. Keep one-event-per-session invariant (`1 session => 1 context_events row`)
2. Preserve existing database schema (no migration required)
3. Preserve MCP tool names/signatures:
   - `search_context`
   - `browse_timeline`
   - `get_event_details`
4. Keep summary-first guidance in MCP instructions/prompts
5. Avoid activity inference from OCR-only content

## Metrics to Observe During Rollout

- Session size:
  - screenshot count per session (p50/p95/p99)
  - interaction events per session (p50/p95/p99)
- Cost control:
  - frames sent to LLM per session (must remain <= configured cap)
- Latency:
  - time from session end to persisted event
- Quality:
  - summary presence rate
  - fallback summary rate
- Reliability:
  - OCR failure rate
  - LLM failure rate
  - screenshot cleanup success rate

## Rollback Triggers

Rollback or gate-disable if any of these persist beyond a short observation window:

- Processing latency regression causes stale recall UX
- Repeated dropped sessions or missing DB events
- Frame cap violations increase cost unexpectedly
- Widespread summary degradation or empty-summary spikes
- Screenshot cleanup failures causing disk growth

## Rollout Sequence

1. Deploy with session feature gate enabled for internal/dev users first.
2. Run the Phase 4 QA checklist with evidence for each matrix row.
3. Observe metrics for at least one full working day.
4. Expand rollout gradually.
5. Remove temporary gate once stable.
