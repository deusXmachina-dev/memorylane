# MemoryLane v1.4.0-alpha.1

Alpha preview of v1.4.0: enterprise device version reporting, plus more reliable app exclusions and device identity.

## What's Changed

- **Device version reporting (enterprise)**: each device reports its installed app version to the backend, so IT can see what's deployed across the fleet (#206).
- **More reliable app exclusions**: excluded apps are matched by bundle id (macOS) / executable name (Windows) instead of display name, so exclusions survive renames and localization (#201).
- **Stable device identity**: a transient storage hiccup no longer regenerates the device id (#199).
- **Reactive LLM health checks**: connectivity is re-checked in response to actual failures instead of probing on every window focus (#198).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.3.0...v1.4.0-alpha.1
