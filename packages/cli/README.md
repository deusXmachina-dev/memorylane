# @deusxmachina-dev/memorylane-cli

CLI for querying the [Memorylane](https://github.com/deusXmachina-dev/memorylane) activity database. Designed for AI agents (Claude Code, Cursor, etc.) to access your screen activity history without the Electron app running.

## Requirements

Node.js **20, 22, or 24 (LTS)**. Other versions may work but are unsupported — `better-sqlite3`, the SQLite driver this CLI depends on, [only ships prebuilt binaries for LTS releases](https://github.com/WiseLibs/better-sqlite3#installation).

## Install

```bash
npm install -g @deusxmachina-dev/memorylane-cli
```

## Setup

Point the CLI at your Memorylane database:

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

### `Could not locate the bindings file` / `Memorylane CLI cannot load its SQLite native module`

The `better-sqlite3` native binary wasn't placed on disk during install. Usually one of:

- **npm install scripts are disabled.** Check with `npm config get ignore-scripts` — must print `false`. Reinstall with `npm install -g @deusxmachina-dev/memorylane-cli --foreground-scripts` to surface what the install script is doing.
- **`prebuild-install` couldn't reach GitHub releases.** This can happen on locked-down corporate networks that mirror the npm registry but not `github.com`. Verify:
  ```bash
  curl -I https://github.com/WiseLibs/better-sqlite3/releases/download/v12.6.2/better-sqlite3-v12.6.2-node-v137-darwin-arm64.tar.gz
  ```
  (Adjust `node-v137` to your Node ABI: 20→`v115`, 22→`v127`, 24→`v137`.) Anything other than `200` or a `302` to a working CDN is the problem.
- **You're on a non-LTS Node version** — see [Requirements](#requirements).

If the install completed but the binary is missing, you can rebuild in place:

```bash
cd "$(npm root -g)/@deusxmachina-dev/memorylane-cli"
npm rebuild better-sqlite3 --foreground-scripts
```

## License

GPL-3.0-or-later
