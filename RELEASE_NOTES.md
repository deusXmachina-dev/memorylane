# MemoryLane v1.5.10

Enterprise uploads stand down while the Mac is asleep, and capture follows device activation.

## What's Changed

- **No uploads during dark wakes**: scheduled database and log uploads skip while the system is suspended, offline, or before the backend host resolves. A suspend aborts an in-flight upload and it retries once the machine is awake and online. Manual "Sync now" still uploads immediately (#289).
- **Capture pauses on deactivated devices**: enterprise capture runs only while the device is activated. Deactivating it in the admin stops capture, reactivating resumes it, and the tray shows why capture is paused. An activated device that starts offline keeps capturing (#290).
- **"Sync now" always uploads**: a manual sync clicked during a scheduled upload no longer reports success without uploading (#292).
- **Claude Cowork plugin 0.7.0**: connects through the desktop app instead of `npx` (#288).

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.5.9...v1.5.10
