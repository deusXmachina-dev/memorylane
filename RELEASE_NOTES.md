# MemoryLane v1.4.0-alpha.3

Alpha preview of v1.4.0. Fixes a Windows startup crash on clean machines and adds one-shot task-mining with persistent clustering.

## What's Changed

- **Fix Windows startup crash on clean machines**: co-locates the x64 VC++ runtime next to the onnxruntime addon so it actually resolves at load time — the alpha.2 fix bundled the runtime but placed it where the loader never found it, so clean machines still crashed with "The specified module could not be found" (#212, follow-up to #211).
- **One-shot task mining**: single-scan default with persistent sighting clustering, plus a one-time in-app backfill on upgrade (#208).
- **Default task-miner model**: OpenRouter defaults to minimax-m3 (ZDR-only preset list).
- **Default video model**: OpenRouter semantic video defaults to Gemini 3.1 Flash Lite (#207).

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0-alpha.2...v1.4.0-alpha.3
