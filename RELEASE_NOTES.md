# MemoryLane v0.24.0

Adds an enterprise consent step before a device is bound to an activation key.

## What's Changed

- **Enterprise consent step on activation** (#126): the activate endpoint is now a probe — when the server returns a consent document, the app renders it (PDF) inline, gates Accept on a checkbox, and only binds the device after the user accepts. Decline returns to key entry; a 15-minute timeout protects against abandoned decisions. Probe responses are restricted to PDF, and the downloaded document is verified against the sha256 from the probe before it is shown.

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS customer (Apple Silicon): install from the latest GitHub release or via the project install script
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.23.8...v0.24.0
