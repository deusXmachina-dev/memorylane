# MemoryLane v0.11.0-win-beta.1

Windows pre-release focused on native app watching, signed installer packaging, and update artifacts required by `electron-updater`.

## What's Changed

- **Native Windows watcher sidecar** - added a Rust-based app watcher binary and wired it into the recorder backend for app-change-aware capture
- **Improved capture context on app switches** - display routing now applies app-change context more accurately, and Explorer noise events are filtered out
- **Activity window overlap fix** - processor time window handling now avoids overlapping activity spans
- **Windows signed build workflow** - added Trusted Signing scripts and `make:win:signed` path to produce signed Windows installers
- **Windows packaging updates** - sidecar resources are now packaged with platform-specific handling for cleaner distribution
- **Windows watcher test coverage** - added unit and E2E tests for watcher/display integration paths

## Notes for Testers

- This is a **Windows prerelease** intended for validation before a stable Windows-focused cut
- Release assets include installer + updater metadata (`latest.yml` and `.blockmap`) for update channel verification
- Windows support remains preview quality while UX and OS-specific polish continue

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.11.0...v0.11.0-win-beta.1
