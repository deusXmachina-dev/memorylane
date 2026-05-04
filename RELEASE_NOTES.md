# MemoryLane v0.26.0-beta.1

Beta. Reworks the LLM client layer behind a single `InferenceProvider`, adds Google Vertex AI for enterprise, and remembers model selections per vendor.

## What's Changed

- **Google Vertex AI support (enterprise)** (#130): the enterprise edition can now route LLM calls through Vertex via the license-issued inference config.
- **Per-vendor model memory** (#130): swapping vendors no longer resets your model picks — each vendor remembers its own snapshot, video, and pattern-detection model.
- **Custom endpoint extended to pattern detection and user-context** (#130): an OpenAI-compatible local endpoint (LM Studio / Ollama) now drives all three LLM features, not just semantic summaries.
- **Unified LLM client provisioning** (#130): internal refactor onto Vercel AI SDK via a shared `InferenceProvider`. Removes the legacy `api-key-manager` / `custom-endpoint-manager` split in favour of a single `vendor-credentials.json`; existing configs migrate automatically on first launch.
- **`summary_model` activity column** (#130): each activity now records which model produced its summary.

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page (this is a prerelease — not surfaced as "Latest")
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.25.0...v0.26.0-beta.1
