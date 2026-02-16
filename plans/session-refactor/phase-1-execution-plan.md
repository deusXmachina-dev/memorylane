# Phase 1 Execution Plan - Recorder Session Loop

## Scope

Implement phase-1 session-based recorder changes while keeping the app buildable between commits.

## Step 1 - Types and Constants

- Add session payload interfaces and callback type in `src/shared/types.ts`
- Add `MAX_SESSION_DURATION_MS` to shared constants

## Step 2 - Recorder Session State Machine

- Add in-memory session lifecycle state in `src/main/recorder/recorder.ts`
- Track session identity, timestamps, screenshots, and interaction events
- Add max-duration timeout handling for active sessions

## Step 3 - Session Callback Contract and Wiring

- Add `onSessionComplete` callback registration in recorder
- Wire `onSessionComplete` in `src/main/index.ts` with migration-safe logging

## Step 4 - Boundary and Flush Correctness

- Close and emit sessions on app switch, max duration, and stop
- Capture final screenshot before emit
- Start the next session immediately after boundary when applicable
- Ensure no duplicate close emits per session

## Step 5 - Window-First Capture Path with Fallback

- Move capture path from screen-first to app-window-first
- Fall back to display capture when window capture is unavailable
- Keep dHash and min-capture-interval behavior

## Step 6 - Regression Verification

- Verify tray start/stop behavior and capture state transitions
- Verify session ordering and boundary reasons via logs/tests
- Run test/lint checks relevant to touched files
