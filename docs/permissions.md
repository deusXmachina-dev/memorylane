# Permissions

MemoryLane needs two macOS permissions to capture activity. Both are gated by macOS TCC (Transparency, Consent, and Control) and must be granted by the user in System Settings → Privacy & Security. The renderer drives the grant flow during onboarding (`PermissionsStep`); the main process does **not** block startup on permissions.

This document is the source of truth for permission behaviour. Update it whenever the permission flow changes.

## Required permissions

| Permission           | Why MemoryLane needs it                                                                                                              | macOS API queried                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **Accessibility**    | Detect app/window focus changes and typing activity (typing _duration_, not content) so captures can be grouped into distinct tasks. | `systemPreferences.isTrustedAccessibilityClient(false)` |
| **Screen Recording** | Capture screenshots of the active display(s) so on-device OCR + embeddings can recognise what was on screen.                         | `systemPreferences.getMediaAccessStatus('screen')`      |

Non-macOS platforms (Windows, Linux) report both as `granted` and skip the flow entirely — the renderer filters the **Permissions** step out of the onboarding stepper based on `api.platform` so it never renders on those platforms.

## Permission states

`getPermissionStatus()` returns `'granted' | 'denied' | 'unknown'` per permission.

- `granted` — fully usable.
- `denied` — user has refused, or never decided and macOS reports a decided non-granted state.
- `unknown` — screen-recording only: macOS returned `not-determined` / `unknown`. Treated as "not yet decided"; the UI still surfaces a Grant button.

Accessibility has no `not-determined` state — `isTrustedAccessibilityClient` returns a boolean, so we map `false → 'denied'`.

## What triggers a TCC prompt

Several Electron / native APIs are TCC-gated. Calling any of them on macOS while the corresponding permission is missing causes macOS to show the native "_App_ would like to control this computer …" / "… record this computer's screen" dialog and add the app to the relevant pane in System Settings.

| API                                                    | Permission       | Notes                                                                                                                                                                                   |
| ------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemPreferences.isTrustedAccessibilityClient(true)` | Accessibility    | Argument `true` explicitly prompts. We use `false` everywhere to read status without prompting.                                                                                         |
| `uIOhook.start()` (`uiohook-napi`)                     | Accessibility    | Starting the input hook triggers the prompt the first time. Called by `startInteractionMonitoring()` from the capture controller.                                                       |
| `globalShortcut.register(...)`                         | Accessibility    | Registering a global hotkey requires Accessibility on macOS. We register the capture hotkey at startup; if Accessibility is missing the registration silently fails but does not crash. |
| `desktopCapturer.getSources({ types: ['screen'] })`    | Screen Recording | Required for capture. Calling it before the permission is granted will not yield usable thumbnails.                                                                                     |

In **dev**, all of these prompts are attributed to the _responsible process_ (the IDE that launched Electron — e.g. "Cursor", "VS Code", "Terminal"), not "MemoryLane". This is a macOS signing/attribution artifact and only goes away in packaged, signed builds.

## Onboarding flow

The renderer's `PermissionsStep` is the single canonical surface for the grant flow. The main process never shows a native dialog asking for permissions.

1. On mount, `PermissionsStep` calls `api.getPermissionStatus()` and subscribes to `onPermissionStatusChanged`.
2. If a permission isn't granted, the user clicks **Grant**, which calls `requestPermission(kind)`.
3. `requestPermission` opens the matching System Settings pane via `open(1)` (see [URL handler caveat](#system-settings-url-handler)) and starts a 2-second polling loop in `main-window.ts`.
4. The poll calls `getPermissionStatus()` and pushes any delta via `main-window:permissionStatusChanged`. The renderer updates the per-permission card status in real time.
5. Polling self-stops once both permissions are `granted`.
6. The "Already granted? **Restart MemoryLane**" link in the UI calls `restartApp` (`app.relaunch()` + `app.quit()`) for users who grant out-of-band and want to make sure everything re-initialises.

Onboarding progress is persisted in `localStorage`:

- `memorylane:onboarding:welcomeSeen`
- `memorylane:onboarding:connectStepDone`
- `memorylane:onboarding:captureStepDone`

Permission state itself is **not** persisted in the app — it always comes from macOS.

## System Settings URL handler

We open Privacy & Security panes via `spawn('open', [url], { detached: true })` rather than `shell.openExternal`. On recent macOS versions, `shell.openExternal` silently no-ops for `x-apple.systempreferences:` URLs when System Settings is already running. `open(1)` is reliable. We keep `shell.openExternal` as a fallback if the spawn fails.

URLs in use:

- Accessibility: `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
- Screen Recording: `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`

## What we do _not_ prompt for

- **Notifications while screen recording.** macOS hides notification banners while any app is recording the screen. We previously surfaced a one-time dialog telling users to enable _Allow notifications when mirroring or sharing the display_ under System Settings → Notifications. This dialog has been removed — it interrupted the user without delivering anything actionable that the user couldn't discover themselves. Users who want notifications during capture can enable that setting manually.
- **Microphone, Camera, Calendar, Contacts, Photos, Reminders, Full Disk Access.** Not used.
- **Apple Events / Automation (`NSAppleEventsUsageDescription`).** Not used.

## Entitlements & Info.plist

`build/entitlements.mac.plist` and `build/entitlements.mac.inherit.plist` declare the hardened-runtime entitlements needed for native modules (`onnxruntime`, `better-sqlite3`, `sharp`, `uiohook-napi`):

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation`

Privacy usage strings (`NS*UsageDescription`) are **not** required for Accessibility or Screen Recording — these permissions are managed entirely through TCC + System Settings and do not surface an `NS*UsageDescription` string in the prompt. If we ever add a permission that does require a usage string (microphone, camera, calendar, etc.), add it to `electron-builder.config.js → mac.extendInfo`.

`extendInfo` currently only sets:

- `LSUIElement: true` — hides the dock icon so MemoryLane runs as a pure tray/menubar app.

## Restart-on-grant

There is no auto-relaunch when a permission is granted. The legacy `ensurePermissions()` flow used to call `app.relaunch()` after Screen Recording was granted, because macOS used to force-quit apps on grant — that is no longer reliable nor needed. Capture machinery picks up new permissions on demand: `desktopCapturer` and `uIOhook` are initialised when capture starts, not at startup, so the user can grant mid-session and start capturing without restarting.

The "Restart MemoryLane" link in the UI exists only as an escape hatch for edge cases (e.g. dev sessions where state is stale).

## Capture lifecycle and permissions

- `startInteractionMonitoring()` calls `uIOhook.start()` — this is the call that surfaces the Accessibility prompt at runtime if it hasn't already been granted.
- Capture starts via the tray menu, hotkey, or `captureCoordinator.resumeCaptureIfDesired(...)` (called at startup if the user had capture enabled when they last quit).
- If capture auto-resumes at startup with stale `autoStartEnabled = true` and Accessibility hasn't been granted, the macOS prompt will appear _before_ the renderer onboarding step — this surfaces as "two permission dialogs fighting" and is usually a sign of stale dev state in `~/Library/Application Support/Electron` (dev) or the app's user-data folder.

## Code references

| Concern                                                                                                                    | File                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Pure status getter, settings opener                                                                                        | `src/main/ui/permissions.ts`                                               |
| IPC handlers (`getPermissionStatus`, `requestPermission`, `openPermissionSettings`, `restartApp`), polling loop, broadcast | `src/main/ui/main-window.ts`                                               |
| Preload bridge                                                                                                             | `src/preload/index.ts`                                                     |
| Shared types (`PermissionKind`, `PermissionState`, `PermissionStatus`)                                                     | `src/shared/types.ts`                                                      |
| Renderer onboarding UI                                                                                                     | `src/renderer/pages/main-window/components/onboarding/PermissionsStep.tsx` |
| Step routing                                                                                                               | `src/renderer/pages/main-window/MainWindowApp.tsx`                         |
| Hotkey registration (Accessibility-gated)                                                                                  | `src/main/capture-hotkey-manager.ts`                                       |
| Input monitoring (Accessibility-gated)                                                                                     | `src/main/recorder/interaction-monitor.ts`                                 |
| Entitlements                                                                                                               | `build/entitlements.mac.plist`, `build/entitlements.mac.inherit.plist`     |
| Info.plist additions                                                                                                       | `electron-builder.config.js → mac.extendInfo`                              |
