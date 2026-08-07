# MemoryLane v1.5.6

Identifying numbers are now stripped before any text leaves for a model, and the user profile no longer times out against slow local models.

## What's Changed

- **Identifying numbers scrubbed at every LLM and MCP seam**: tax file numbers, bank BSB and account numbers, Medicare and IRD numbers, credentials, and phone numbers are replaced with a placeholder before text reaches a model or an outside tool — task-mining scans, cluster review, the user profile, semantic search, and MCP responses. Names, companies and email addresses are deliberately kept: they are what make a task legible as client work. Screenshots and activity text stay unchanged on disk; scrubbing happens on the way out (#278).
- **User profile no longer aborts at 3 minutes**: the profile builder sent a full multi-day activity summary in one call but capped it at a 3-minute deadline, so against a slow local model it failed on every scheduled run and never built. It now uses the same timeout as task mining, which the existing slider — relabelled "Task analysis timeout" — already controls (#277).
- **Corrected model cost estimates**: the built-in price table was stale for several OpenRouter models, and four newly benchmarked models were missing from it entirely. Reported spend now matches what the app actually pays.

## Known Issues & Limitations

- Postal addresses are not scrubbed — no reliable pattern separates them from ordinary navigation paths and page text.
- Existing per-machine Windows installs (v1.3.x and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.5...v1.5.6
