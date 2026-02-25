# Windows Release Completion Plan

## Context

- Branch already includes a Windows app-watcher backend and Rust sidecar (`native/windows/app-watcher`), wired via `src/main/recorder/app-watcher-win.ts` and `src/main/recorder/app-watcher.ts`.
- Goal is to make Windows capture/release reliable without regressing macOS.

## Remaining Required Steps

1. **Finalize event/type contract**
   - Extend `AppWatcherEvent` in `src/main/recorder/app-watcher.ts` to include:
     - `windowBounds?: { x: number; y: number; width: number; height: number }`
     - `displayId?: number`
   - Mirror these fields in `InteractionContext` (`src/shared/types.ts`) for app-change context.

2. **Use display-aware capture in ActivityManager**
   - Thread `event.displayId` through capture calls in `src/main/processor/activity-manager.ts`:
     - `captureImmediate('activity_start', ...)`
     - `captureImmediate('activity_end', ...)`
     - `captureIfVisualChange('visual_change', ...)`
     - force-split and force-close paths
   - Keep `captureWindowByTitle` as best effort, but use display capture as fallback when title capture misses.

3. **Make build scripts platform-correct**
   - Keep `make:win` on `build:rust` + Windows packaging.
   - Keep `make:mac` on `build:swift` + mac packaging.
   - Update generic `package` / `make` scripts so they do not hard-require Swift on Windows.

4. **Make electron-builder resources platform-correct**
   - Move Swift resources to `mac` scope only.
   - Keep Rust sidecar resources in `win` scope.
   - Keep PowerShell OCR script available where Windows OCR needs it.
   - Verify packaged runtime paths match:
     - Windows watcher: `process.resourcesPath/rust/app-watcher-windows.exe`
     - Windows OCR: `process.resourcesPath/powershell/windows-ocr.ps1`

5. **Validate end-to-end on Windows**
   - Build/package: `npm run make:win`
   - Runtime smoke checks:
     - app watcher emits `ready`, `app_change`, `window_change`
     - activities are created and finalized
     - screenshots are captured on expected display
     - OCR path executes without missing-resource errors
   - Test pass:
     - unit tests for watcher/display resolution
     - `npm run test:e2e:app-watcher-win`

## Done Criteria

- Windows installer builds from a clean checkout.
- Installed app starts capture and produces persisted activities on Windows.
- No macOS packaging regression (`npm run make:mac` still works).
