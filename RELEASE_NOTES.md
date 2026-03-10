# MemoryLane v0.14.3-rc.1

Release candidate focused on managed Windows rollout controls, packaging improvements, and MCP integration updates.

## What's Changed

- **Managed auto-update control** - Added `MEMORYLANE_DISABLE_AUTO_UPDATE` to disable updater initialization in packaged builds
- **Windows packaging updates** - Added MSI build target and configured NSIS for per-machine elevated installs
- **CLI MCP server mode** - Added MCP server mode in the CLI so plugin workflows can run without the desktop app
- **Plugin installation reliability** - Updated plugin MCP config and installation docs to reduce setup friction
- **Privacy matching behavior** - Capture privacy patterns now match substrings by default, with added test coverage
- **Startup reliability** - Set Electron `userData` path before app ready in dev mode to avoid cache initialization issues

## Features

- Managed environments can disable in-app auto-updates with `MEMORYLANE_DISABLE_AUTO_UPDATE`
- Windows builds now ship both `MemoryLane-Setup.exe` (NSIS) and MSI artifacts
- CLI supports MCP server mode for plugin-first usage

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Linux and Intel macOS are not yet officially supported

## Installation

- macOS (Apple Silicon): install from the latest GitHub release or via the project install script
- Windows: download release assets from GitHub (`MemoryLane-Setup.exe` or MSI)

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.14.2...v0.14.3-rc.1
