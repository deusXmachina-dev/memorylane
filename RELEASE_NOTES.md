# MemoryLane v1.3.1-beta.1

Windows hotfix (prerelease): the app no longer crashes at startup on clean machines.

## What's Changed

- **Fixed startup crash on clean Windows machines**: on Windows without the Microsoft VC++ redistributable (including ARM machines running the x64 build under emulation), the app crashed at launch with "The specified module could not be found" before the tray loaded, because `onnxruntime_binding.node` couldn't resolve the VC++ runtime. The required runtime DLLs are now bundled beside the native module, so no separate redistributable install is needed.

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

https://github.com/deusXmachina-dev/memorylane/compare/v1.3.0...v1.3.1-beta.1
