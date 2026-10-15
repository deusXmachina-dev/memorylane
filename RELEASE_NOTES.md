# MemoryLane v1.5.11

Electron 44, refreshed default models, more accurate reading time and a faster, cleaner quit.

## What's Changed

- **Electron 44**: upgraded Electron, Node 24, transformers 4 and other dependencies; npm audit fixes.
- **Requires macOS 13+**: macOS 12 no longer receives updates.
- **Smaller installers**: only the current platform's ML runtime is bundled.
- **New summarization models**: refreshed default model chains; video is sent in the `video_url` format OpenRouter expects (#295).
- **New task-mining default**: glm-5.3-flash, falling back to mimo-v2.6-flash and minimax-m3 (#294).
- **Reading time ends at your last input**: windows no longer stretch past when you stopped reading (#303).
- **Key and click sequences**: typing and click events record the order of keys and clicks (enter, delete, copy, paste, double-click…), never characters (#298).
- **Fewer false app switches**: title changes of only symbols are ignored (#297).
- **Faster, cleaner quit**: the last summary gets 3s instead of blocking exit; on macOS the screenshot stream stops before the capture helper exits (#304, #305).
- **Uploads start on activation** instead of waiting for the hourly check (#291).
- **Device report includes key source**: managed, own key, or none (#293).
- **Links open in the system browser** (#296).
- **Import dialog opens in Documents**, where exports are saved.
- **Periodic export folder removed**: the manual ZIP export stays.
- **Scripted eval recordings** in Developer mode (#302).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.10...v1.5.11
