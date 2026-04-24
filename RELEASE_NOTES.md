# MemoryLane v0.23.8

Fix the MCP server crashing on start when launched by Claude Desktop.

## What's Changed

- **MCP server no longer crashes with `Cannot find module 'electron'`**: a top-level `import { app } from 'electron'` in `edition.ts` was code-split into a shared chunk that the MCP entry transitively required. Under `ELECTRON_RUN_AS_NODE=1` the `electron` module is unresolvable, so the process died before `main()` ran. Electron APIs are now read through a lazy, shared `getElectronAppOrNull()` helper, and a compiler-API-based guard test fails if any file in the MCP import graph reintroduces a top-level `electron` import.

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS customer (Apple Silicon): install from the latest GitHub release or via the project install script
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.23.7...v0.23.8
