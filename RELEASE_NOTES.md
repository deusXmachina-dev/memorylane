# MemoryLane v1.0.0-rc.1

First 1.0 release candidate. Major UI shift toward a transparency-first product: you can see exactly what MemoryLane has captured and the recurring workflows it found, with evidence for each.

## What's Changed

- **Activities page**: replaces the per-minute flat list with a trust digest (total captures, time span, top apps, top sites) plus a day-grouped audit log that collapses consecutive same-app captures into expandable rows. Includes substring search and click-to-filter chips from the digest.
- **Patterns page**: new split-view ranked by likely impact (~hours/week × recurrence × confidence × recency). Each pattern shows recurrence sentence, description, apps, a "Copy prompt for Claude" action, and a sightings timeline with linked source activities.
- **Onboarding**: renderer-driven flow with state machine, Windows-specific permission handling, and skip-on-existing-recordings detection.
- **Main window shell**: unified `PageLayout`, shadcn pill controls, sidebar with collapsible state, persistent Activities state across navigation. Resizable window.
- **Enterprise**: backend keeps the managed key on backend 5xx instead of clearing it; smoother activation when the backend already has consent on file (DEU-93).
- **Storage**: new `getPatternDetail` and `getActivityDigest` IPC; pattern ranking moved from SQL ordering to composite scoring in the repo layer.
- **Settings**: tightened custom vendor `baseURL` validation; stricter database export directory validation.
- **Release pipeline**: GitHub Actions pinned to commit SHAs; release workflow resolves the input ref to an immutable SHA once and reuses it across jobs.

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.
- This is a release candidate: auto-update channels for customer builds are not yet pointed at 1.0.x.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page.
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.26.1...v1.0.0-rc.1
