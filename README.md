# MemoryLane

## TL;DR

Desktop app that sees what you see, stores summaries about it locally and lets you query it in any AI chat via MCP.

**Screenshots → local storage → MCP into AI chats**

🎬 [Demo](https://www.loom.com/share/513b213e82d14323999e419fa434576d)

## Privacy & Permissions

MemoryLane captures your screen to give AI assistants context about what you're working on. Here's what that means in plain terms:

- **Screen Recording** — the app takes screenshots of your display. macOS will ask you to grant Screen Recording permission. This means the app can see everything on your screen while capture is running.
- **Accessibility** — the app monitors keyboard and mouse activity (clicks, typing sessions, scrolling) to decide _when_ to capture. macOS will ask you to grant Accessibility permission. The app does not log keystrokes.
- **What happens to screenshots** — each screenshot is sent to a cloud vision model (Mistral by default, which has a zero data retention policy) for summarization and OCR. The screenshot is then deleted.
- **What is stored** — only short text summaries and OCR extracts are kept, in a local SQLite database on your machine. Nothing leaves your device except the screenshot sent for processing.
- **API key** — you need an [OpenRouter](https://openrouter.ai/) API key. The key is stored locally using Electron's encrypted safeStorage.

> **Bottom line:** you are giving this app permission to see your screen and detect your input. All captured data is processed into text and stored locally. Be mindful of sensitive content on screen while capture is active.

## Current Status

> **⚠️ Early release**
>
> This is a fully functional early release. Expect rough edges.
>
> The app is code-signed but not yet Apple-notarized. Use the curl installer below to avoid Gatekeeper warnings.

### What works today

- Event-driven screen capture (typing, clicking, scrolling, app switches, visual changes)
- OCR via macOS Vision framework
- AI-powered activity summarization (Mistral Small, GPT-5 Nano, Grok-4.1 Fast, Gemini Flash Lite via OpenRouter)
- Semantic + full-text search over your activity history
- MCP server with `search_context`, `browse_timeline`, and `get_event_details` tools
- One-click integration with Claude Desktop, Claude Code, and Cursor
- Configurable capture settings and API usage tracking

## Installation

### Requirements

- macOS (Apple Silicon / ARM64)
- [OpenRouter](https://openrouter.ai/) API key

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/deusXmachina-dev/memorylane/main/install.sh | sh
```

This downloads the latest release and installs it to `/Applications`.

### First launch

1. Grant **Screen Recording** permission when prompted
2. Grant **Accessibility** permission when prompted
3. Enter your **OpenRouter API key** in the app window

## Usage

### Start capturing

Click the MemoryLane icon in your menu bar and select **Start Capture**. The app will begin taking screenshots based on your activity — typing sessions, clicks, scrolling, app switches, and visual changes on screen. You can stop anytime from the same menu.

### Connect to an AI assistant

From the tray menu, click **Add to Claude Desktop**, **Add to Claude Code**, or **Add to Cursor**. This registers MemoryLane as an MCP server so your AI assistant can query your activity history.

You can also set it up manually by pointing your MCP client to the MemoryLane server binary.

### Example queries

Once connected, try asking your AI assistant things like:

- "What was I working on this morning?"
- "Pick up where I left off on the auth refactor"
- "Summarize my research on **\_** from last week"
- "List the design frameworks I looked at recently"
- "When did I last review PR #142?"

## How It Works

AI conversations are full of friction because LLMs have no context about you. MemoryLane fixes that by watching what you do and making it searchable.

1. The app captures screenshots based on user activity triggers (not fixed intervals)
2. A cloud vision model extracts a short summary and OCR text from each screenshot
3. The screenshot is deleted — only the text summary is stored locally in SQLite
4. Vector embeddings enable semantic search over your history
5. An MCP server exposes your history to AI assistants on demand

### Why cloud AI models?

**Performance** — local models are ~4 GB and turn laptops into space heaters. We believe most users prefer speed and normal battery life from an invisible background app.

**Quality** — cloud models perform significantly better for summarization and OCR. Local models make a nice demo but fall short when users expect reliable output.

That said, we'd love to see someone prove us wrong — it's one reason we open-sourced this.

## Build from Source

1. Clone this repo
2. `npm install`
3. `npm run dev` to start in development mode
4. See [CLAUDE.md](CLAUDE.md) for full development commands and architecture details

## Limitations

1. **macOS ARM64 only** — this release is Apple Silicon only; Intel Mac, Windows, and Linux builds are planned

## Coming Soon

- **Browser integration** — deeper context from browser tabs and web apps
- **Managed cloud service** — hosted version with richer integrations, online LLM tool access, and zero setup
- **Cross-platform builds** — Intel Mac, Windows, and Linux support
