# MemoryLane v0.18.0

Minor release: enterprise edition support, MCP CLI cleanup, and plugin workflow updates.

## What's Changed

- Added edition-aware customer and enterprise build flow with activation support
- Moved MCP into the standalone CLI package and added public HTTP mode with ngrok/token auth
- Converted plugin commands into skills and added a safer deploy-plugin release workflow
- Fixed plugin marketplace validation by normalizing the plugin name

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS (Apple Silicon): install from the latest GitHub release or via the project install script
- Windows: download the latest GitHub release and use either `MemoryLane-Setup.exe` or `MemoryLane-Setup.msi`

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.17.4...v0.18.0
