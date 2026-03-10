# MemoryLane v0.14.3-rc.2

Release candidate update focused on finalizing Windows MSI packaging defaults and release artifact publishing.

## What's Changed

- **Release workflow artifact coverage** - GitHub release pipeline now uploads, verifies, and publishes `MemoryLane-Setup.msi` alongside existing Windows installer assets
- **MSI packaging defaults** - Added explicit MSI settings for machine-wide, one-click installs
- **Static MSI naming** - MSI artifact now uses a fixed filename (`MemoryLane-Setup.msi`) to keep build outputs and release checks predictable

## Features

- Windows release assets now include both `MemoryLane-Setup.exe` and `MemoryLane-Setup.msi` with stable naming
- MSI output is explicitly configured for managed rollout behavior (`perMachine: true`, `oneClick: true`)

## Known Issues & Limitations

- Windows OCR still depends on native OCR component availability
- Linux and Intel macOS are not yet officially supported

## Installation

- macOS (Apple Silicon): install from the latest GitHub release or via the project install script
- Windows: download release assets from GitHub (`MemoryLane-Setup.exe` or `MemoryLane-Setup.msi`)

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.14.3-rc.1...v0.14.3-rc.2
