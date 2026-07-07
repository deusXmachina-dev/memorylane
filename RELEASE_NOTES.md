# MemoryLane v1.4.0-alpha.5

Alpha preview of v1.4.0. The Patterns view is now backed by task-miner clusters.

## What's Changed

- **Patterns view rebuilt on task mining**: recurring tasks are now mined into persistent clusters and shown with honest stats — times seen, ×/week frequency, span vs hands-on time per run, and a recurrence histogram (#210).
- **Task classification**: each cluster gets a kind verdict (procedure, monitoring, ambient, dev-loop, judgment); procedures show a concrete "Replace with" elimination mechanism.
- **Copy prompt for Claude**: one click copies a research-and-automate prompt for a cluster, ready to paste into Claude Cowork.
- **One-off noise gate**: tasks seen once are hidden from the list unless they already cost meaningful time.
- **60-day backfill**: first launch after upgrading mines the last 60 days of history into sightings (previously 30); already-mined days are skipped.
- Cluster stats are windowed to the last 90 days and recurrence bars follow your local timezone.
- Default mining model is now minimax-m3.

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.4.0-alpha.4...v1.4.0-alpha.5
