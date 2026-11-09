# MemoryLane v1.5.15-alpha.1

Better activity summaries, and MemoryLane never records itself.

## What's Changed

- **Better activity summaries on OpenRouter**: summaries are built from screenshots instead of video, which keeps more on-screen detail (#322).
- **Fewer near-duplicate screenshots dropped**: the change threshold for summary screenshots goes from 8% to 2%. An explicitly picked pipeline or a threshold you tuned is kept on upgrade (#322).
- **Submitted input is recognized**: Enter, Cmd/Ctrl+Enter, paste and save during typing are passed to the summarizer, so sent messages and saved work read as done (#322).
- **MemoryLane is always blocked**: the app's own windows are never captured. The blocklist shows it as a locked row (#334).
- **Settings no longer reload on open**, and app/website lists stop showing "Loading…" when you return to the tab (#334).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.14...v1.5.15-alpha.1
