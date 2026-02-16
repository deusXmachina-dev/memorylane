# Phase 4 QA Checklist (Integration, Validation, Rollout)

Use this checklist to validate session-based capture and processing end-to-end.
Mark each item as PASS/FAIL and include evidence links (logs, test output, screenshots).

## 1) End-to-End Session Matrix

- [ ] **PASS / FAIL** Session closes on `app_switch`
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Session closes on `max_duration`
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Session closes on `stop`
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** No visual changes in session still yields initial + final capture only
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Frequent visual changes enforce LLM frame cap
  - Evidence:
  - Notes:

## 2) Data Integrity

- [ ] **PASS / FAIL** Exactly one DB row per completed session
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Stored `text` contains OCR from all session screenshots in chronological order
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Stored `summary` is present and coherent at session level
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Stored `appName` equals session app identity
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Stored `timestamp` uses session start timestamp
  - Evidence:
  - Notes:

## 3) MCP Behavior

- [ ] **PASS / FAIL** Activity questions are answered from summaries
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** OCR is used only for exact recall (quotes, file names, errors, commands)
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** `search_context`, `browse_timeline`, `get_event_details` APIs remain backward compatible
  - Evidence:
  - Notes:

## 4) Performance and Cost

- [ ] **PASS / FAIL** LLM image cap is enforced for every processed session
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Session processing latency is within acceptable budget
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Memory usage remains stable for long-running sessions
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Screenshot files are cleaned after successful processing
  - Evidence:
  - Notes:

## 5) Failure and Recovery

- [ ] **PASS / FAIL** OCR failure still persists useful event output (summary/fallback text path)
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** LLM failure path uses fallback summary strategy and does not drop event
  - Evidence:
  - Notes:
- [ ] **PASS / FAIL** Recoverable failures do not leak screenshot files
  - Evidence:
  - Notes:

## 6) Release Readiness

- [ ] **PASS / FAIL** No DB migration required
- [ ] **PASS / FAIL** Lint/tests pass for modified scope
- [ ] **PASS / FAIL** Rollout metrics dashboard/log fields confirmed
- [ ] **PASS / FAIL** Rollback plan documented and rehearsed

## QA Sign-off

- Date:
- Owner:
- Build/Commit:
- Overall verdict: **GO / NO-GO**
- Follow-up actions:
