# @deusxmachina-dev/memorylane-cli

CLI for querying the [MemoryLane](https://github.com/deusXmachina-dev/memorylane) activity database. Designed for AI agents to access your screen activity history without the Electron app running.

## Requirements

Node.js **22 or later**, on macOS, Linux, or Windows (x64 or arm64). The SQLite driver, `better-sqlite3`, bundles its prebuilt binaries for these platforms.

## Install

```bash
npm install -g @deusxmachina-dev/memorylane-cli
```

## Setup

Point the CLI at your MemoryLane database:

```bash
memorylane set-db ~/Library/Application\ Support/MemoryLane/memorylane.db
```

On Windows:

```bash
memorylane set-db "%APPDATA%\MemoryLane\memorylane.db"
```

## Commands

```bash
memorylane stats                          # Database statistics
memorylane search "auth refactor"         # Full-text search
memorylane search "auth" --mode vector    # Semantic search
memorylane timeline --limit 10            # Recent activities
memorylane timeline --app Chrome          # Filter by app
memorylane activity <id>                  # Activity details
memorylane patterns                       # Detected patterns
memorylane pattern <id>                   # Pattern details
memorylane get-db                         # Show resolved DB path
```

## DB path resolution

1. `--db-path` flag (always wins)
2. `MEMORYLANE_DB_PATH` env var
3. Saved config via `memorylane set-db`
4. Platform default

## Semantic search

Vector search uses `@huggingface/transformers` (installed automatically as an optional dependency). If it failed to install on your platform, you can install it manually:

```bash
npm install -g @huggingface/transformers
```

## Troubleshooting

### `MemoryLane CLI cannot load its SQLite native module`

- **Check your Node version** with `node -v`. It must be 22 or later.
- **Check your platform.** Prebuilt binaries cover macOS, Linux (glibc and musl), and Windows on x64 and arm64. Anything else needs a local build toolchain.
- **Reinstall** to restore missing files: `npm install -g @deusxmachina-dev/memorylane-cli`.

## License

GPL-3.0-or-later
