# MemoryLane v0.23.7

Edition-aware default DB path for the MCP server.

## What's Changed

- **Enterprise MCP uses the enterprise DB by default**: on the enterprise build, `productName = "MemoryLane Enterprise"` shifts Electron's userData directory, but the MCP server's default DB path was hardcoded to the customer location. Enterprise users therefore saw an empty DB through MCP with no obvious workaround. The default path is now edition-aware across macOS, Windows, and Linux (dev and packaged).
- **New `get_db_path` MCP tool**: returns `{ path, source, edition, defaultForEdition }` so Claude can verify which DB is being read and decide whether to call `set_db_path` / `reset_db_path`.
- **Tray tooltip shows the app version**: hovering the tray icon now includes `v<version>`, and the tray menu has a disabled version entry.

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS customer (Apple Silicon): install from the latest GitHub release or via the project install script
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.23.6...v0.23.7
