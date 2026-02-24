# Windows Re-Enable Plan (Compact)

## Goal

Restore stable Windows support for the full v2 pipeline (capture -> activity context -> OCR -> storage -> MCP), not just preview-level behavior.

## P0 (Must Work)

- [ ] **Screen capture backend for Windows**  
       Add a Windows implementation behind `src/main/v2/recorder/native-screenshot.ts` (or split by platform) so capture does not depend on the mac Swift `build/swift/screenshot` binary.
- [ ] **Platform capture abstraction**  
       Introduce a backend selector (`darwin`/`win32`) with one output contract (`filepath`, `width`, `height`, `displayId`) and explicit startup errors when no backend is available.
- [ ] **Windows app/window watcher backend**  
       Add `win32` backend wiring in `src/main/recorder/app-watcher.ts` so `interaction-monitor` receives real app/title changes instead of mostly unknown context.
- [ ] **Windows preflight checks at startup**  
       Extend `src/main/ui/permissions.ts` into platform-specific preflight checks (capture availability, input hook availability, OCR prerequisites) rather than mac-only permission flow.
- [ ] **Windows packaging inputs**  
       Update `electron-builder.yml` so Windows builds include Windows-specific sidecars and do not require mac Swift artifacts in Windows release flow.

## P1 (Reliability + UX)

- [ ] **Harden Windows OCR runtime**  
       Keep `src/main/processor/ocr-windows-native.ts` + `windows-ocr.ps1`, but add robust checks for PowerShell availability, OCR language packs, clear diagnostics, and timeout/fallback behavior.
- [ ] **Capture degradation behavior**  
       If app-watcher is unavailable, keep capture running but surface "reduced context mode" in logs/UI so users know app/window attribution is degraded.
- [ ] **Startup/user messaging**  
       Add Windows-specific onboarding/help text (what settings to verify, how to fix missing OCR components, what preview limitations remain).
- [ ] **Auto-update + signing readiness**  
       Validate NSIS + `electron-updater` behavior on signed Windows builds and document required cert/signing setup before public rollout.

## P2 (Validation + Release)

- [ ] **Windows test coverage**  
       Add unit tests for Windows backend selection and parsing; add opt-in integration smoke tests for Windows screenshot + OCR paths (mirroring current mac-native integration tests).
- [ ] **Cross-platform CI gate**  
       Add at least one Windows build/test job so regressions are caught before release.
- [ ] **Docs and release cleanup**  
       Update `README.md`, `RELEASE_NOTES.md`, and install guidance to reflect actual Windows status and first-run behavior.

## Definition of Done

- [ ] Clean Windows install can: start capture, persist activities with non-empty app context, run OCR (or cleanly degrade), query data through MCP tools, and pass Windows build/test checks.
