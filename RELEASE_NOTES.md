# MemoryLane v0.25.0

Reshapes the enterprise activation flow around a single user-facing activation code and a Bearer-auth backend contract.

## What's Changed

- **Single activation code for enterprise** (#128): users now paste one `tt_<token>.<email>` activation code instead of separate fields. The device parses it locally, sends `tenant_token` and `email` to the backend, and uses Bearer auth on `/license/*` and `/device/upload` endpoints. The consent document is fetched up-front via a descriptor, hash-verified, and pinned to the configured backend origin to prevent off-host redirection. 401 on `/status` and `/key` is now treated as inactive rather than an error.
- **Skip semantic client rebuild on no-op key updates** (#127): `updateApiKey` no longer rebuilds the embedding client when the key hasn't changed.

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Intel macOS is not yet officially supported

## Installation

- macOS customer (Apple Silicon): install from the latest GitHub release or via the project install script
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.24.0...v0.25.0
