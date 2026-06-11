# MemoryLane v1.2.0-alpha.1

Alpha preview. Sharper activity capture — passive reads are now recorded, and several timeline accuracy bugs are fixed.

> This is a prerelease for manual install only. Stable installs will not auto-update to it.

## What's Changed

- **Passive reads are captured**: viewing a page or document with no clicks or typing is now recorded as a "Viewed …" entry and stays searchable via its on-screen text. Previously these no-input reads were dropped (#165).
- **Long sessions no longer get dropped**: a continuous scroll or typing session is kept alive instead of being cut off mid-session, and sessions are flushed on app switch (#161).
- **First activity is no longer "Unknown"**: the app already focused when capture starts is now identified correctly (#162).
- **Cleaner activity boundaries**: trailing frames that briefly leak the next app at an app switch are trimmed (#164).
- **Debug**: under `DEBUG_PIPELINE`, screenshots and activity videos are retained and dev file logs are written next to the dev DB for inspection (#160).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.1.0...v1.2.0-alpha.1
