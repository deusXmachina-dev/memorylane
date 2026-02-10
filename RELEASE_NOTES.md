# MemoryLane v0.3.0

MemoryLane is a macOS system tray app that captures your screen activity, processes it with OCR and AI summarization, and makes it searchable through an MCP server — giving AI assistants like Claude and Cursor memory of what you've been working on.

## What's Changed

- **Multi-screen capture** — captures from all connected displays, not just the primary screen (closes [#4](https://github.com/deusXmachina-dev/memorylane/issues/4))
- **Different-size screen handling** — correctly captures screens with different resolutions and dimensions

## Features

- **Multi-screen capture** — captures screenshots from all connected displays simultaneously
- **Event-driven screen capture** — captures screenshots based on user interactions (clicks, typing, scrolling, app switches) and visual changes (perceptual dHash comparison), not fixed intervals
- **OCR via macOS Vision** — extracts text from screenshots using the native Vision framework (Swift sidecar)
- **AI-powered summarization** — classifies activity into concise summaries using vision models via OpenRouter (Mistral Small, GPT-5 Nano, Grok-4.1 Fast, Gemini Flash Lite)
- **Semantic search** — vector embeddings (all-MiniLM-L6-v2) + SQLite FTS5 for full-text and semantic search over your activity history
- **MCP server** — exposes `search_context`, `browse_timeline`, and `get_event_details` tools for AI assistants
- **One-click integrations** — register the MCP server with Claude Desktop or Cursor from the tray menu
- **Configurable capture settings** — adjust visual change threshold, typing timeout, scroll timeout via the UI
- **Secure API key storage** — uses Electron's safeStorage for encrypted key persistence
- **Usage tracking** — monitors API requests, token usage, and costs

## Known Issues & Limitations

- **Not notarized** — the app is code-signed but not Apple-notarized yet; install via the curl command above to avoid Gatekeeper warnings ([#5](https://github.com/deusXmachina-dev/memorylane/issues/5))
- **macOS ARM64 only** — this release is Apple Silicon only; Intel Mac, Windows, and Linux builds are not yet available

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/deusXmachina-dev/memorylane/main/install.sh | sh
```

This downloads the latest release and installs it to `/Applications`. No Gatekeeper warnings.

After launching:

1. Grant **Screen Recording** permission when prompted
2. Grant **Accessibility** permission when prompted
3. Set your **OpenRouter API key** in the app window
4. Optionally register the MCP server with Claude Desktop or Cursor

## Full Changelog

https://github.com/deusXmachina-dev/memorylane/commits/v0.3.0
