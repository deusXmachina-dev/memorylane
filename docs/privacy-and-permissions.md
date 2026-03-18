# Privacy & Permissions

MemoryLane captures your screen to give AI assistants context about what you're working on. Here's what that means in plain terms:

- **Screen Recording** — the app takes screenshots of your display. macOS will ask you to grant Screen Recording permission. This means the app can see everything on your screen while capture is running.
- **Accessibility** — the app monitors keyboard and mouse activity (clicks, typing sessions, scrolling) to decide _when_ to capture. macOS will ask you to grant Accessibility permission. The app does not log keystrokes.
- **What happens to screenshots** — screenshots are sent to your configured model endpoint for summarization (OpenRouter by default, or a custom endpoint such as local Ollama). The screenshots are then deleted.
- **What is stored** — only short text summaries, OCR extracts, and vector embeddings are kept in a local SQLite database on your machine. Nothing leaves your device except the screenshot sent for processing.
- **Endpoint credentials** — by default, the app uses [OpenRouter](https://openrouter.ai/) and needs API credentials. You have two built-in options:
  - **Power User ($30/month)** _(recommended)_ — includes automation recommendations, no API keys needed. We provision an OpenRouter API key tied to your device. MemoryLane does **not** proxy your requests. Your screenshots go directly from your machine to OpenRouter.
  - **Bring Your Own Key** — already have an OpenRouter account? Paste your own API key instead. You pay OpenRouter directly and have full control over your account, usage limits, and billing.
  - You can also configure a custom OpenAI-compatible endpoint (for example a local Ollama server), including its own auth header if needed.
  - Any saved secret is encrypted and stored locally using Electron's safeStorage.

**Privacy controls** let you exclude apps, window titles, and URLs by substring; automatic private/incognito browsing suppression; tray icon reflects privacy state.

> **Bottom line:** you are giving this app permission to see your screen and detect your input. All captured data is processed into text and stored locally. Screenshots are sent directly from your machine to the configured model endpoint (OpenRouter by default, or your custom provider). MemoryLane never proxies your capture payloads.
