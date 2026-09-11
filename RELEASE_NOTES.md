# MemoryLane v1.5.8

Task mining no longer gives up on a day because a closed laptop woke overnight without network.

## What's Changed

- **Overnight dark wakes no longer fail mining days**: a closed laptop briefly wakes with no network, and the overdue sweep claimed yesterday in those windows — three failed requests marked the day failed for good. Scheduled sweeps now stand down while suspended or offline, network errors across a suspend or during a confirmed outage don't spend attempts, and resuming kicks the miner. Local models keep mining offline. Days already failed this way are re-opened (#285).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.7...v1.5.8
