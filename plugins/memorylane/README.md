# MemoryLane for Claude

See what you actually work on and which tasks are worth automating. These skills read screen activity history from MemoryLane and turn it into summaries, automation plans, and client-ready reports.

## Requirements

- A MemoryLane account (the plugin includes the connector), or the [MemoryLane desktop app](https://trymemorylane.com) on macOS or Windows with your data on this computer.
- Install: add the `deusxmachina-dev/memorylane` marketplace in Claude, then install **MemoryLane**. In Claude Code: `/plugin install memorylane --marketplace deusxmachina-dev/memorylane`
- Setup steps: [INSTALL.md](INSTALL.md).

## Skills

| Skill                              | What it does                                               |
| ---------------------------------- | ---------------------------------------------------------- |
| `recent-activity`                  | Summarize your last 30 minutes (desktop app only)          |
| `analyze-processes`                | Measure repeated tasks and what automating them would save |
| `build-report`                     | Turn an analysis into an HTML report and PDF               |
| `write-automation-guide`           | Step-by-step build guide for Claude, n8n, or Zapier        |
| `build-n8n-workflow` (beta)        | Build an n8n workflow from a process                       |
| `build-netsuite-automation` (beta) | Build a NetSuite automation from a process                 |

## Data and privacy

**What it reads.** App names, window titles, website domains, times, AI-written activity summaries, text read from your screen (OCR), and detected task patterns. It does not return screenshots.

- With the MemoryLane connector (enterprise.trymemorylane.com): your organization's MemoryLane data, as far as your account permits. This includes people's emails, nicknames, teams and devices, plus the organization's timezone, currency and hourly rate. It is read-only.
- With the desktop app: the activity database on this computer.

**Where it goes.** Into your Claude conversation, only when a skill asks for it. Some skills also send details of your work elsewhere, as listed below.

**What it downloads or contacts.**

- The npx data reader (INSTALL.md, option 2b) may download a public text-search model (all-MiniLM-L6-v2) from Hugging Face the first time it runs. None of your data is sent.
- `build-report` downloads logos and brand icons from the web (a logo link you give it, cdn.simpleicons.org, cdn.jsdelivr.net). The icon links contain the names of tools and clients from your activity, so those sites can see them. It makes PDFs with Playwright or a browser already on your computer.
- `analyze-processes` checks vendor documentation on the web before recommending a connector, so those lookups can include the names of your tools.
- `build-n8n-workflow` and `build-netsuite-automation` search the web for documentation, and those searches can include details of your process. If you've added an n8n or NetSuite connection to Claude, they use it: `build-n8n-workflow` creates the workflow, built from your activity, in your n8n (unpublished); NetSuite is read-only.

**What it saves.** Only files you ask for (reports, PDFs, workflow files) in your working folder or a temp folder. `analyze-processes` may copy the database to a temp folder to query it. If you choose a different database with the npx data reader, its path is saved in `~/.config/memorylane/cli.json`.

**How long.** The plugin keeps nothing on its own. Desktop activity history stays in the app's database until you delete it there. Connector data is held on enterprise.trymemorylane.com under your organization's terms, and the plugin can't delete it.

**The desktop app (separate install).** It captures your screen and sends screenshots and activity text to an AI model to write summaries and find patterns. With the built-in plan, requests go through OpenRouter only to providers with [Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr): they don't store your data or train on it. With your own key or endpoint (such as a local Ollama), that provider's policy applies. Screenshots are deleted from your computer after processing. Full details: [Privacy & Permissions](https://github.com/deusXmachina-dev/memorylane/blob/main/docs/privacy-and-permissions.md).

## License

GPL-3.0. See [LICENSE](LICENSE).
