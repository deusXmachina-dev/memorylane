# MemoryLane v0.11.2-win-beta.1

Patch-level Windows prerelease focused on startup behavior and data export improvements.

## What's Changed

- **Auto-start controls** - added a launch-at-login setting in advanced settings for packaged Windows and macOS builds
- **Auto-start enabled by default** - packaged builds now register launch at login on first run and can start hidden in the tray
- **Capture state persistence** - capture resumes based on the last saved state after restart or wake/resume flows
- **Database export flow** - added a UI action to export a zipped local database backup from the app

## Notes for Testers

- This is a **Windows prerelease** intended for validation before a stable Windows-focused cut
- Release assets include installer + updater metadata (`latest.yml` and `.blockmap`) for update channel verification
- Windows support remains preview quality while UX and OS-specific polish continue

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.11.1-win-beta.1...v0.11.2-win-beta.1
