# Using Your Own Models

Point MemoryLane at your own LLM instead of the built-in managed one — a local model (Ollama, vLLM, LM Studio) or your OpenRouter account. No rebuild needed; it's all in Settings.

Everything else stays on your machine regardless: screen capture, OCR, text search, and embeddings all run locally. Only the LLM summarization/analysis calls go out, and only to the endpoint you pick.

## Quick start

During first-run onboarding, on the **Plan** step, click **"Use your own API key in settings"**. That jumps you straight to **Settings → AI models**, where you set it up (below). Once your key is saved, onboarding continues — no subscription needed.

Already past onboarding? Open **Settings → AI models** anytime.

## Option A — Local or self-hosted endpoint (Ollama, vLLM, LM Studio)

1. **Settings → AI models → Vendor** → choose **OpenAI-compatible endpoint**.
2. Click **Advanced: override base URL** and enter your endpoint. **It must end in `/v1`:**
   - Ollama: `http://localhost:11434/v1`
   - On your LAN: `http://192.168.1.50:5000/v1`
   - Remote: `https://llm.mycompany.com/v1`
3. Enter an **API key** if your server needs one. For local Ollama, leave it blank.
4. **Save.**
5. Open **Intelligence → Advanced options** and set the model IDs to your server's model names:
   - Video analysis model (e.g. `moondream`)
   - Snapshot analysis model (e.g. `mistral`)
   - Automation opportunities model (e.g. `llama2:70b-chat`)
6. Click **Test LLM Connection** and check **LLM Health** is green.

**Ollama tip:** pull the models first and use the exact tag as the model ID:

```bash
ollama pull mistral
ollama pull llama2:70b-chat   # use the full tag, not just "llama2"
```

## Option B — OpenRouter

1. **Settings → AI models → Vendor** → **OpenRouter**.
2. Paste your API key (`sk-or-v1-...`, from https://openrouter.ai/keys). There's no base-URL field — it's fixed.
3. **Save.**
4. In **Intelligence → Advanced options**, set the model IDs using OpenRouter's `vendor/model` names, e.g. `google/gemini-2.5-flash`, `mistralai/mistral-small-3.2-24b-instruct`.
5. **Test LLM Connection.**

## Good to know

- **Three models, set independently.** Video analysis, snapshot analysis, and "automation opportunities" each have their own model ID, so you can mix fast/cheap and slow/smart models.
- **Model names aren't checked when you save.** A typo only shows up when analysis runs — watch **LLM Health** and the model's behavior.
- **HTTP vs HTTPS.** Plain `http://` works only for `localhost` and private/LAN addresses (`10.x`, `192.168.x`, `172.16–31.x`). Public addresses must use `https://` (your API key rides in the request header).
- **Switching vendors keeps your settings.** Each vendor remembers its own key and model choices, so you can flip back and forth.
- **Power-user shortcut:** you can set credentials with environment variables before launching the app instead of using the UI — `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`, `OPENROUTER_API_KEY`. Env vars win over whatever's saved in the UI.

## Connecting your own AI client (MCP)

MemoryLane can serve your captured history to an AI assistant over MCP (read-only — it never touches recording). Claude Desktop and Cursor are registered automatically when you install the app; in those clients you'll find a **memorylane** server with tools to search your timeline and activity.

## Local processing — nothing to configure

- **OCR** uses your OS: Vision on macOS, the built-in OCR on Windows 10+. Linux has no OCR (capture still works, text is just empty).
- **Embeddings / search** run on-device with a small bundled model. No setup, no external service, no API key.

## Where your data lives

Everything is stored locally:

- **macOS:** `~/Library/Application Support/MemoryLane/`
- **Windows:** `%APPDATA%\MemoryLane\`
- **Linux:** `~/.config/MemoryLane/`

That folder holds the database (`memorylane.db`), your settings, and your saved credentials (encrypted). Raw screenshots are deleted right after they're processed.

## Troubleshooting

- **"HTTP is only allowed for localhost and private networks"** — your URL is public but uses `http`. Use `https`, or a private/LAN address.
- **"Base URL is required for this vendor"** — the OpenAI-compatible option needs a base URL; fill in the field.
- **Requests fail / 404** — your base URL is probably missing the `/v1` at the end.
- **Ollama "model not found"** — use the full tag (`llama2:70b-chat`), not the base name, and make sure you pulled it.
- **LLM Health is red** — double-check the base URL, key, and that your server is running. Quick test from a terminal: `curl -H "Authorization: Bearer <key>" http://localhost:11434/v1/models`.
- **Video analysis falls back to images** — expected with image-only local models (`moondream`, `llava`). Set the media pipeline to **image**, or use a model that supports video.
- **Changed a key but the old one's still used** — environment variables override the UI. Unset them (or clear the saved credentials) to be sure which is active.
