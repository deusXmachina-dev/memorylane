# Add Main Application Window

The tray icon can be invisible when the user has too many tray items. Add a small main window as an additional control surface. The tray stays unchanged.

---

## 1. Create the main window (HTML + renderer)

Add `main-window.html`, `main-window.ts`, and `main-window.css` in `src/renderer/`.

The window should:

- Match the settings window dark style (zinc-900 bg, zinc-800/50 cards, same button classes)
- Be small and compact (~400×300)
- Show the app name at the top
- Have a **Start / Stop Capture** toggle button (large, prominent)
- Have a **Settings** button that opens the existing settings window
- Show a minimal status line (e.g. "Capturing" / "Idle", screenshot count)

IPC needed:

- `main-window:getStatus` — returns `{ capturing: boolean, screenshotCount: number }`
- `main-window:toggleCapture` — starts or stops capture, returns new state
- `main-window:openSettings` — opens settings window
- Push event from main → renderer when capture state changes (so the button updates live)

## 2. Create the main window module (main process)

Add `src/main/ui/main-window.ts` (similar pattern to `settings-window.ts`):

- Singleton `BrowserWindow` (~400×300, not resizable, title "MemoryLane")
- Loads `main-window.html` (dev server or file path)
- Register the IPC handlers listed above
- Export `openMainWindow()` and `getMainWindow()` (for sending push events)
- Show on app ready, after `setupTray()` (tray stays as-is)
- On close: hide instead of destroy, so re-opening is instant

Wire it up in `src/main/index.ts`:

- Call `openMainWindow()` after `setupTray()`
- Show dock icon on macOS when the window is visible (hide again when it's hidden)

Update `electron.vite.config.ts` if a new HTML entry point is needed for the build. Expose the new IPC channels through `contextBridge` in the preload script.

## 3. Move integrations into Settings

Add "Add to Claude Desktop" and "Add to Cursor" to the settings window (keep them in the tray too):

- Add an **Integrations** section at the bottom of `settings.html` (same card style)
- Two buttons: "Add to Claude Desktop" / "Add to Cursor"
- Wire them via IPC (`settings:addToClaude`, `settings:addToCursor`)
- Add the IPC handlers in `settings-window.ts` (call existing `registerWithClaudeDesktop` / `registerWithCursor`)
