# screenshot-capturer-mac

Rust sidecar for macOS active-screen screenshot capture.

This process runs continuously using a long-lived ScreenCaptureKit `SCStream`. It prefers the display containing the active on-screen window, falls back to the main display (or first available display), caches the latest streamed frame, and writes one PNG per interval from that cached frame.

## Event Contract

Each line on stdout is a JSON object with:

- `type`: `ready` | `display_change` | `screenshot_saved` | `error`
- `timestamp`: Unix time in milliseconds
- `displayId`: macOS `CGDirectDisplayID` (`display_change` and `screenshot_saved`)
- `filepath`: absolute PNG path (`screenshot_saved`)
- `width`: image width in pixels (`screenshot_saved`)
- `height`: image height in pixels (`screenshot_saved`)
- `error`: error message (`error`)

## Arguments

- `--output-dir <absolute-or-relative-path>` (required)
- `--interval-ms <milliseconds>` (optional, default `1000`)

## Build

From repo root:

```bash
npm run build:rust
```

On macOS, this compiles the crate and copies the binary to:

- `build/rust/screenshot-capturer-mac`

## Runtime Integration

- Spawned by the v2 recorder backend.
- Optional executable override in development:
  - `MEMORYLANE_SCREENSHOT_CAPTURER_MAC_EXECUTABLE=<absolute path>`
