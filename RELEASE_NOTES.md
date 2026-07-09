# MemoryLane v1.4.0-alpha.6

Alpha preview of v1.4.0. This build rebuilds the Patterns clustering for quality.

## What's Changed

- **No more umbrella patterns**: clusters now group by what each task means (title + description), with average-linkage grouping that can't chain unrelated topics into one mega-cluster (#214).
- **Clusters can heal**: over-merged clusters are split, drifted members are moved out, and a declined merge stays declined instead of being re-asked every run.
- **Automatic rebuild**: existing clusters are wiped and re-mined from your sighting history on first launch after updating — the Patterns view repopulates on its own.
- **Smoother during mining**: the embedding model and clustering math run in a background worker capped to half the CPU cores, so the app and your machine stay responsive.
- Background worker errors now reach the log file in packaged builds.

## Known Issues & Limitations

- MCP pattern tools (`list_patterns`, `get_pattern_details`) still read the legacy pattern data and won't reflect the new clusters yet.
- Existing per-machine Windows installs (v1.4.0-alpha.3 and earlier) are not removed automatically: uninstall MemoryLane from Program Files once (requires admin), then run the new setup.
- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe` — installs per-user, no admin needed.
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0-alpha.5...v1.4.0-alpha.6
