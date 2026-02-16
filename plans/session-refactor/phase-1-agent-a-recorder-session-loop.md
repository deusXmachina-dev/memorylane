# Phase 1 - Agent A: Recorder Session Loop

## Objective

Refactor recorder behavior from per-event capture to **application session capture**:

- Capture initial screenshot when app session starts
- Capture additional screenshots on significant visual changes
- Capture final screenshot when session ends
- Emit one completed session payload to processor

## Primary Files

- `src/main/recorder/recorder.ts`
- `src/main/recorder/interaction-monitor.ts`
- `src/shared/constants.ts`
- `src/shared/types.ts` (if new session interfaces are added)
- `src/main/index.ts` (integration points, if callback signatures change)

## Implementation Scope

1. **Define Session State**
   - Add in-memory session state in recorder:
     - current app identity (process + title)
     - session start time
     - collected screenshots
     - collected interaction events
     - last capture timestamp
   - Add explicit session end reasons:
     - `app_switch`
     - `max_duration`
     - `stop`

2. **Session Start Logic**
   - On first active app detection (or recorder start), create a session.
   - Capture initial application-window screenshot for that session.

3. **In-Session Capture Logic**
   - Reuse current visual change detector (dHash) for significant-change captures.
   - Continue enforcing minimum capture interval.
   - Append screenshot metadata in chronological order.

4. **Session End Logic**
   - Trigger end on:
     - app switch
     - stop capture
     - max session duration reached
   - Capture one final screenshot of the old app window.
   - Emit completed session payload via new callback (`onSessionComplete` style contract).
   - Immediately start a new session for the new active app when applicable.

5. **Window-Capture Path**
   - Move from full-screen-first behavior to application-window capture.
   - Handle fallback behavior if direct window capture fails for a source.

6. **Config**
   - Add `MAX_SESSION_DURATION_MS` in shared constants.
   - Keep existing dHash threshold and min capture interval configurable.

## Deliverables

- Recorder emits completed app sessions, not raw per-screenshot pipeline callbacks.
- Session payload contract documented in code.
- Max session duration cutoff implemented and tested.
- No behavior regression for start/stop controls in tray flow.

## Acceptance Criteria

- App switch always closes prior session and starts a new one.
- Stop capture always flushes current session (with final screenshot).
- Session can close on max duration without app switch.
- Screenshot order is strictly chronological.
- No duplicate session close events for the same session.

## Risks and Mitigations

- **Risk:** Active-window detection jitter causes false boundaries  
  **Mitigation:** Debounce app switch handling and compare stable app identity.
- **Risk:** Window source lookup fails on some apps  
  **Mitigation:** Fallback to current screen capture path and log downgrade.
- **Risk:** Existing screenshot cleanup removes files before processing  
  **Mitigation:** Tie cleanup to post-session processing rather than short TTL.

## Handoff to Agent B

- Provide final TypeScript interface for completed session payload.
- Provide callback semantics (exactly-once delivery guarantees per session).
- Provide end-reason semantics and timestamp rules.
