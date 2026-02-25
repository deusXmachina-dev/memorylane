# screenshot-capturer-windows

Rust sidecar for long-lived Windows screenshot capture in v2.

The process accepts JSONL commands on stdin and emits JSONL events on stdout.

## Commands

- `start`:
  - `outputDir`
  - `intervalMs`
  - optional `maxDimensionPx`
  - optional `displayId`
  - optional `targetBoundsPx` (`x`, `y`, `width`, `height`)
- `set_display`:
  - optional `displayId`
  - optional `targetBoundsPx`
- `stop`

## Events

- `ready`
- `frame` (`filepath`, `width`, `height`, `displayId`, `timestamp`)
- `error` (`error`, `timestamp`)

## Build

From repo root:

```bash
npm run build:rust
```

Binary output:

- `build/rust/screenshot-capturer-windows.exe`
