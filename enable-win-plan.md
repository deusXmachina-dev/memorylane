# Windows Enablement Plan

This plan outlines the steps to make MemoryLane run reliably on Windows while preserving current macOS behavior.

## Goal

- Enable local development (`npm run dev`) on Windows.
- Enable test/build/package flows on Windows.
- Provide Windows-compatible OCR and permissions behavior.
- Add CI coverage to prevent regressions.

## Current Gaps Identified

- Unix-only scripts and commands in `scripts/enode.sh`, `install.sh`, and `scripts/install-local.sh`.
- Unix env var syntax in `package.json` scripts (for example `LOG_LEVEL=debug ...`).
- macOS-only OCR implementation in `src/main/processor/ocr.ts` and `src/main/processor/swift/ocr.swift`.
- macOS-specific assumptions in `scripts/mcp-dev.ts` (`/bin/bash`, `/Applications/...` paths).
- Unix-only temporary file paths in tests (for example `/tmp/...` in `src/main/processor/index.test.ts`).
- No Windows CI job to validate ongoing compatibility.

## Phase 0 - Baseline and Tooling

1. Confirm Windows prerequisites in docs:
   - Node LTS and npm version.
   - Visual Studio Build Tools (native module support).
2. Verify fresh setup on Windows:
   - `npm install`
   - `npm run postinstall`
3. Record baseline failures (dev, test, build) to validate progress after each phase.

## Phase 1 - Make Scripts Cross-Platform (Highest Priority)

1. Replace shell-only script usage in `package.json`:
   - Move from `./scripts/enode.sh ...` to a Node-based launcher (for example `scripts/enode.js/ts`) that works on all platforms.
2. Normalize env var assignment:
   - Add `cross-env` and update scripts such as `dev`.
3. Keep install scripts platform-aware:
   - Gate macOS-only installers (`install.sh`, `scripts/install-local.sh`) behind platform checks or document them as macOS-only.
4. Fix tests with Unix path assumptions:
   - Replace `/tmp/...` with `os.tmpdir()` + `path.join(...)` in `src/main/processor/index.test.ts`.

Acceptance criteria:
- `npm run dev` works in PowerShell and cmd.
- `npm test` passes on Windows.
- `npm run db:search`, `npm run db:stats`, and `npm run mcp:start` run without shell incompatibility.

## Phase 2 - OCR Strategy for Windows (Critical Runtime Gap)

1. Refactor OCR entrypoint in `src/main/processor/ocr.ts` to be platform-selectable:
   - macOS: keep current Swift/Vision path.
   - Windows: add Windows-supported OCR backend.
2. Implement a Windows OCR backend:
   - Prefer a local option first (for privacy/offline usage), with clear dependency/setup notes.
3. Add graceful fallback behavior:
   - If OCR backend is unavailable, fail with clear diagnostic logs and non-crashing app behavior.

Acceptance criteria:
- Screenshot capture and OCR processing function on Windows.
- Processing pipeline continues to behave correctly when OCR fails.

## Phase 3 - Windows Platform Behavior and Permissions

1. Review permission flow in `src/main/ui/permissions.ts`:
   - Keep macOS-specific permission logic on `darwin`.
   - Add Windows-specific checks/prompts where applicable.
2. Validate platform branches in app startup:
   - Ensure macOS-only APIs (for example dock-related behavior) are guarded.
3. Confirm tray/menu behavior on Windows:
   - Validate icon format and tray interactions.

Acceptance criteria:
- App launches and remains stable on Windows.
- Required capture/input functionality works with expected Windows UX.

## Phase 4 - MCP and Local Integration Scripts

1. Refactor `scripts/mcp-dev.ts` to remove hardcoded macOS shell/path assumptions.
2. Implement platform-specific command invocation:
   - Use Windows command execution paths on `win32`.
   - Preserve current macOS behavior.
3. Validate generated config and launch flow for Windows host applications.

Acceptance criteria:
- `npm run mcp:dev` works on Windows.
- No hardcoded `/bin/bash` or `/Applications/...` assumptions remain in runtime paths.

## Phase 5 - Packaging, Installer, and Documentation

1. Ensure Windows artifacts are produced with existing builder config:
   - Validate `npm run make:win`.
2. Add or document a Windows install path:
   - Provide a Windows installation script or explicit manual install instructions.
3. Update `README.md`:
   - Add Windows support status, setup steps, known limitations (especially OCR).

Acceptance criteria:
- Windows package can be generated and installed.
- README supports first-time Windows users without external tribal knowledge.

## Phase 6 - CI and Release Hardening

1. Add Windows CI job(s) in `.github/workflows/` for:
   - Install
   - Test
   - Build/package smoke checks
2. Keep Linux/macOS jobs unchanged while adding Windows coverage.
3. Set minimum required checks before release.

Acceptance criteria:
- Every PR gets Windows validation.
- Regressions in scripts/native deps are caught before release.

## Risk Register

- Native module compatibility (`uiohook-napi`, `sharp`, `better-sqlite3`) may require toolchain tuning.
- OCR backend differences may affect text quality or performance.
- Shell/path assumptions can hide in less-used scripts; require focused grep pass and CI enforcement.
- Line ending/path separator differences can introduce subtle bugs without Windows test coverage.

## Suggested Execution Order

1. Phase 1 (cross-platform scripts/tests)  
2. Phase 2 (Windows OCR)  
3. Phase 3 (permissions/platform behavior)  
4. Phase 4 (MCP dev flow)  
5. Phase 5 (packaging/docs)  
6. Phase 6 (CI hardening)

## Validation Matrix

- Shells: PowerShell, cmd (optionally Git Bash).
- Commands:
  - `npm install`
  - `npm run dev`
  - `npm test`
  - `npm run build`
  - `npm run make:win`
  - `npm run db:stats`
  - `npm run mcp:start`
  - `npm run mcp:dev`
- Runtime checks:
  - app launches
  - tray visible and interactive
  - capture + OCR path works
  - data persists and retrieval still works
