# app-watcher-windows

Rust sidecar for Windows focused-window monitoring.

It emits JSONL events to stdout so the Electron main process can convert foreground app/window changes into interaction context.

## Event Contract

Each line is a JSON object with:

- `type`: `ready` | `app_change` | `window_change` | `error`
- `timestamp`: Unix time in milliseconds
- `app`: process name (for app/window events)
- `pid`: process id (for app/window events)
- `title`: window title (for app/window events)
- `windowBounds`: `{ x, y, width, height }` in screen pixels (for app/window events)
- `error`: error message (for `error` events)

## Build

From repo root:

```bash
npm run build:rust
```

This compiles the Rust crate and copies the binary to:

- `build/rust/app-watcher-windows.exe`

## Runtime Integration

- Spawned by `src/main/recorder/app-watcher-win.ts`
- Backend selection is done in `src/main/recorder/app-watcher.ts`
- Display routing fallback is handled in `src/main/recorder/app-watcher-display.ts`

Optional override in development:

- `MEMORYLANE_APP_WATCHER_WIN_EXECUTABLE=<absolute path to exe>`

## Test

From repo root:

```bash
npm run test:e2e:app-watcher-win
```

Artifacts are written to `.debug-app-watcher-win/<timestamp>/`.
