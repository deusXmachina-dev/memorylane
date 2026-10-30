# MemoryLane — Installation

## 1. Install the plugin

Watch the [installation walkthrough](https://www.loom.com/share/f8bcc7db424746b99c0a93748dec3da6).

Install from the GitHub Marketplace:

```
deusxmachina-dev/memorylane
```

The plugin includes the MemoryLane connector.

## 2. Sign in

Sign in to the **MemoryLane** connector: `/mcp` in Claude Code, **Settings > Connectors** in Claude. Skills then read your organization's data, as far as your account permits.

<details>
<summary><h2>2a. Data on this computer (MemoryLane desktop app installed)</h2></summary>

Use this instead if you have the desktop app and your data, or a downloaded database, is on this computer.

1. Go to **Integrations** and click **Add to Claude**.

![Integrations settings](../../assets/readme/integrations-add-to-claude.png)

2. Restart Claude Desktop.

If a skill reports the MemoryLane tools are unavailable, open **Integrations** and click **Reconnect**.

</details>

<details>
<summary><h2>2b. A downloaded database (no desktop app)</h2></summary>

This is for reading a downloaded MemoryLane database without the desktop app, for example someone else's shared data.

Watch the [MCP setup walkthrough](https://www.loom.com/share/b6330ba741654a87bc9875105c973daa).

1. Open the config file:

   | OS          | Path                                                              |
   | ----------- | ----------------------------------------------------------------- |
   | **macOS**   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
   | **Windows** | `%APPDATA%\Claude\claude_desktop_config.json`                     |

2. Add `memorylane` inside the `mcpServers` object ([copy from our repo](https://github.com/deusXmachina-dev/memorylane/tree/main/plugins/memorylane)):

   ```json
   {
     "mcpServers": {
       "memorylane": {
         "command": "npx",
         "args": ["-y", "-p", "@deusxmachina-dev/memorylane-cli@latest", "memorylane-mcp"],
         "env": {}
       }
     }
   }
   ```

   If you already have other MCP servers, add the `"memorylane": { ... }` block alongside them.

3. Restart Claude Desktop.

To use a custom database path, set `MEMORYLANE_DB_PATH` in the config:

```json
"env": {
  "MEMORYLANE_DB_PATH": "/path/to/your/memorylane.db"
}
```

Or use the `set_db_path` tool after connecting.

</details>
