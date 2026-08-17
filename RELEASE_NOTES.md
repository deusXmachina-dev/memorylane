# MemoryLane v1.5.7

Windows upgrades now remove the orphaned per-machine install, and long unattended views get a real summary instead of "Viewed X".

## What's Changed

- **Old per-machine Windows install removed on upgrade**: builds up to v1.4.0-alpha.4 installed to Program Files. The per-user installer only checks HKCU, so it installed beside the old copy and both ran against the same app data — double capture and double spend. Setup now finds the per-machine install and runs its uninstaller first, and re-registers autostart when the executable moves. The eviction needs one admin prompt; declining it lets the install proceed and the prompt returns next time you run setup by hand (#283).
- **Long passive views are summarised properly**: a view with no input was labelled from its window title alone, so minutes spent in a call, watching an agent, or reading turned into "Viewed Claude". Past 60 seconds these now take the normal semantic path, and the model is told no click, type or scroll happened so a long read isn't reported as authorship (#281).
- **Recipe steps keep the app name**: cluster review dropped the `<app>: action` prefix on runs of steps inside one app, leaving the app visible on the first line only (#282).
- **Token counts in the summary log line**: prompt and completion tokens were parsed but never logged, so generation speed couldn't be computed from a log bundle (#280).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.6...v1.5.7
