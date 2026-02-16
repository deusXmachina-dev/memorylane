# Session-Based Capture Refactor Plan

## Goal

Move from per-screenshot processing to session-based processing:

- Recorder groups screenshots by active application session
- Session ends on app switch, max session duration, or stop recording
- Processor runs once per completed session
- OCR is concatenated chronologically into `text`
- LLM generates one high-level activity `summary` per session
- MCP guidance emphasizes summary-first reasoning and OCR-only recall

Database shape stays unchanged (`context_events` schema remains the same).

## Team Setup (4 Agents)

1. **Agent A - Recorder Session Loop**
   - Owns session lifecycle, capture triggers, and session handoff to processor
2. **Agent B - Processor Session Pipeline**
   - Owns OCR concatenation, session-level LLM summarization, and storage
3. **Agent C - MCP Guidance and Prompting**
   - Owns MCP instructions/prompts to enforce summary-first interpretation
4. **Agent D - Integration, QA, and Rollout**
   - Owns end-to-end validation, regression checks, telemetry, and launch safety

## Phase Order and Parallelism

- **Phase 1 (Agent A)** should land first because it changes producer contracts.
- **Phase 2 (Agent B)** starts after Phase 1 contract is stable.
- **Phase 3 (Agent C)** can run in parallel with late Phase 2, but should merge after Phase 2 prompt/output behavior is finalized.
- **Phase 4 (Agent D)** starts once Phases 1-3 are code-complete.

## Shared Contracts

- Recorder now emits completed **application sessions** instead of individual screenshot callbacks.
- Session payload should include:
  - `sessionId`
  - `appName` (active app process name)
  - `startTimestamp` and `endTimestamp`
  - `screenshots[]` in chronological order
  - `interactionEvents[]` in chronological order
  - `endReason` (`app_switch`, `max_duration`, `stop`)
- Processor persists exactly one `context_events` row per session:
  - `timestamp`: session start time
  - `text`: concatenated OCR from all session screenshots
  - `summary`: one LLM-generated session description
  - `appName`: session app name
  - `vector`: embedding generated from summary

## Risk Controls (Must Have)

- Keep a max session duration to avoid extremely large sessions.
- Cap number of images sent to LLM (first/last + sampled middle frames).
- Do not infer user intent from OCR in MCP instructions.
- Preserve current search APIs and database schema for compatibility.
