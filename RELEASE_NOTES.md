# MemoryLane v1.5.11-alpha.1

Refreshed default models and faster first uploads after activation.

## What's Changed

- **New summarization models**: refreshed default model chains; video is sent in the `video_url` format OpenRouter expects. Existing installs switch to the new defaults (#295).
- **New task-mining default**: task mining, user context and cluster review default to glm-5.3-flash, falling back to mimo-v2.6-flash and minimax-m3 (#294).
- **Uploads start on activation**: activating a device, or turning sharing on, starts uploads right away instead of waiting for the hourly check (#291).
- **Device report includes key source**: reports whether the device uses a managed key, its own key, or none (#293).

## Known Issues & Limitations

- Postal addresses are not scrubbed — no reliable pattern separates them from ordinary navigation paths and page text.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.10...v1.5.11-alpha.1
