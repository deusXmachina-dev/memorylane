# MemoryLane for Claude

See what you actually work on and which tasks are worth automating. These skills read your screen activity history from the MemoryLane desktop app and turn it into summaries, process maps, automation plans, and client-ready reports.

## Requirements

- The [MemoryLane desktop app](https://trymemorylane.com) on macOS or Windows, capturing your activity.
- Setup steps: [INSTALL.md](INSTALL.md).

## Skills

| Skill                        | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| `last-30-minutes`            | Summarize your last 30 minutes                             |
| `discover-patterns`          | Find repeated workflows worth automating                   |
| `process-analyst-new`        | Measure repeated tasks and what automating them would save |
| `report-new`                 | Turn an analysis into an HTML report and PDF               |
| `pattern-to-pdf`             | Write up one process as a PDF                              |
| `automation-instructions`    | Step-by-step build guide for Claude, n8n, or Zapier        |
| `process-to-n8n` (beta)      | Build an n8n workflow from a process                       |
| `process-to-netsuite` (beta) | Build a NetSuite automation from a process                 |

## Data and privacy

**What it reads.** Your MemoryLane activity database on this computer: app names, window titles, website domains, times, AI-written activity summaries, text read from your screen (OCR), and detected task patterns. It does not return screenshots.

**Where it goes.** Into your Claude conversation, only when a skill asks for it. The plugin sends your activity to no other service.

**What it downloads or contacts.**

- The data reader may download a public text-search model (all-MiniLM-L6-v2) from Hugging Face the first time it runs. None of your data is sent.
- `report-new` downloads logos and brand icons from the web (a logo link you give it, cdn.simpleicons.org, cdn.jsdelivr.net) and may install Playwright from npm to make PDFs.
- `process-to-n8n` and `process-to-netsuite` read public documentation on the web. They use your own n8n or NetSuite connection only if you've added one to Claude. NetSuite is read-only; n8n workflows are created unpublished.

**What it saves.** Only files you ask for (reports, PDFs, workflow files) in your working folder, `~/Desktop/automation/`, or a temp folder. `process-analyst-new` may copy the database to a temp folder to query it. If you choose a different database, its path is saved in `~/.config/memorylane/cli.json`.

**How long.** The plugin keeps nothing on its own. Your activity history stays in the desktop app's database until you delete it in the app.

**The desktop app (separate install).** It captures your screen and sends screenshots and activity text to an AI model to write summaries and find patterns. With the built-in plan, requests go through OpenRouter only to providers with [Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr): they don't store your data or train on it. With your own key or endpoint (such as a local Ollama), that provider's policy applies. Screenshots are deleted from your computer after processing. Full details: [Privacy & Permissions](https://github.com/deusXmachina-dev/memorylane/blob/main/docs/privacy-and-permissions.md).

## License

GPL-3.0. See [LICENSE](LICENSE).
