# Privacy & Permissions

MemoryLane captures your screen to give AI assistants context about what you're working on. Here's what that means in plain terms:

- **Screen Recording**: the app takes screenshots of your display. macOS will ask you to grant Screen Recording permission. This means the app can see everything on your screen while capture is running.
- **Accessibility**: the app monitors keyboard and mouse activity (clicks, typing sessions, scrolling) to decide _when_ to capture. macOS will ask you to grant Accessibility permission. The app does not log keystrokes.
- **What happens to screenshots**: screenshots are sent to your configured model endpoint for summarization (OpenRouter by default, or a custom endpoint such as local Ollama). The screenshots are then deleted from your computer.
- **What is stored**: short text summaries, OCR extracts, and vector embeddings, kept in a local SQLite database on your machine until you delete them. OCR and embeddings run on your machine.
- **Endpoint credentials**: by default, the app uses [OpenRouter](https://openrouter.ai/) and needs API credentials. You have two built-in options:
  - **Explorer ($100/month)** _(recommended)_: includes automation recommendations, no API keys needed. We provision an OpenRouter API key tied to your device, restricted to providers with [Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr): they don't store your screenshots or activity text, or train on them. MemoryLane does **not** proxy your requests. Your screenshots go directly from your machine to OpenRouter.
  - **Bring Your Own Key**: already have an OpenRouter account? Paste your own API key instead. You pay OpenRouter directly and have full control over your account, usage limits, billing, and data retention settings.
  - You can also configure a custom OpenAI-compatible endpoint (for example a local Ollama server), including its own auth header if needed.
  - Any saved secret is encrypted and stored locally using Electron's safeStorage.

## What leaves your computer

- **To the AI model you use**: screenshots (or a short video of them) with the app name, window title, and website domain, to write each summary. For pattern detection and your user profile, activity summaries, app names, window titles, and some OCR text. With a local endpoint, none of this leaves your machine.
- **To MemoryLane's server**: a device report (app version, platform, and whether you use a managed or your own key), plus regular subscription and model-settings checks (every few minutes on our plan). Each request carries your device ID. No screen content.
- **To your AI assistant**: if you connect Claude (Settings → Integrations, or the plugin), the activity summaries, OCR text, and patterns it looks up go into that conversation, under that provider's policy.
- **To GitHub**: update checks and downloads.
- **Enterprise only**: a daily copy of your activity database and the app's logs go to your organization's MemoryLane server, unless sharing is turned off in Settings → Data → Share with remote. At the **Summary** level, OCR text and the search index are left out; summaries, window titles, your user profile, and detected tasks are still sent, and these can contain text from your screen.

**Privacy controls** let you exclude apps, window titles, and URLs by substring; the tray icon reflects privacy state. Two exclusions run on their own, both on by default and switchable in Settings → Privacy:

- **Private / incognito browsing**: we match the English names browsers commonly use (Incognito, InPrivate, Private Browsing). Once a window matches, everything in it stays out for as long as it's open. A browser that says so in another language, or not at all, can slip through.
- **Sign-in screens**: we match common English sign-in pages (logins, single sign-on, password resets) plus password manager apps. Capture picks up again by itself once you move on. A screen in another language, or an unusual one, can slip through.

> **Bottom line:** you are giving this app permission to see your screen and detect your input. Captured data is processed into text and stored locally. Screenshots and activity text go directly from your machine to the model endpoint you configure (OpenRouter with Zero Data Retention by default, or your own provider). MemoryLane never proxies your capture payloads.
