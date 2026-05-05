# MemoryLane v0.26.0

Reworks the LLM client layer behind a single `InferenceProvider`, adds Google Vertex AI for enterprise, remembers model selections per vendor, and bakes per-customer backend URLs into enterprise builds at build time.

## What's Changed

- **Google Vertex AI support (enterprise)** (#130): the enterprise edition can now route LLM calls through Vertex via the license-issued inference config.
- **Per-vendor model memory** (#130): swapping vendors no longer resets your model picks — each vendor remembers its own snapshot, video, and pattern-detection model.
- **Custom endpoint extended to pattern detection and user-context** (#130): an OpenAI-compatible local endpoint (LM Studio / Ollama) now drives all three LLM features, not just semantic summaries.
- **Unified LLM client provisioning** (#130): internal refactor onto Vercel AI SDK via a shared `InferenceProvider`. Removes the legacy `api-key-manager` / `custom-endpoint-manager` split in favour of a single `vendor-credentials.json`; existing configs migrate automatically on first launch.
- **`summary_model` activity column** (#130): each activity now records which model produced its summary.
- **Enterprise: per-customer backend URL** (#134): build a per-customer binary with `MEMORYLANE_BACKEND_URL=...` baked in at build time. Replaces the earlier activation-code-embedded URL.
- **Enterprise: detailed activity sync by default**: fresh enterprise installs default `uploadDetailLevel` to `detailed` so the backend receives the full feed without manual opt-in.
- **Electron 40.1.0 → 40.9.2** (#131).

## Fixes

- User-context model now comes from per-vendor settings instead of the legacy global slot (#133).

## Known Issues & Limitations

- Vertex managed-mode bearer tokens aren't refreshed in-flight — long-running operations that outlive the token TTL may see 401s until the next refresh cycle (DEU-84).
- Windows OCR still depends on native OCR component availability.
- Intel macOS is not yet officially supported.

## Installation

- macOS customer (Apple Silicon): install from the GitHub release page (auto-update enabled).
- macOS enterprise (Apple Silicon): `MemoryLane Enterprise-arm64-mac.pkg` — delivered privately per customer.
- Windows customer: `MemoryLane-Setup.exe`
- Windows enterprise: `MemoryLane Enterprise-Setup.msi` — delivered privately per customer.

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/compare/v0.25.0...v0.26.0
