# MemoryLane v1.2.0

Stable release. Rolls up the 1.2.0 alpha series into the first stable since 1.1.0: passive-read capture, more reliable activity boundaries, faster device uploads, and log export.

## What's Changed

- **Pause as default**: the tray now defaults to a clear pause/resume control that auto-resumes reliably after the machine sleeps (#187).
- **Passive reads captured**: time spent reading without interacting is now recorded via a presence heartbeat with lightweight "Viewed" summaries (#165).
- **Faster, lighter uploads**: device DB uploads are gzipped and the prep work runs off the main thread, so the UI no longer freezes during sync (#179).
- **Export app logs**: export logs to a ZIP from Settings → Data for easier troubleshooting (#175).
- **More reliable activity boundaries**: trim trailing frames that leaked across app boundaries (#164), keep long interaction sessions alive and finalize windows in close order (#161), and emit the initial frontmost app so the first activity isn't "Unknown" (#162).
- **Sync reliability**: enterprise DB uploads are now regularized via catch-up scheduling (#171).
- **Per-activity summary state**: summary mode and failure reason are persisted per activity (#178).
- **UI polish**: removed sidebar collapse layout jitter and hide the logo when collapsed (#166, #173).
- **Internal**: in-app eval recorder and golden review tooling behind Developer mode; pattern detection reworked around sightings; Molmo dropped from the video summarization pipeline; logging noise reduced.

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.1.0...v1.2.0
