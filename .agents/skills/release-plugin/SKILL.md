---
name: deploy-plugin
description: Deploy the MemoryLane Claude Code plugin by verifying only plugin/marketplace files changed, bumping the plugin version, then committing and pushing.
---

# Deploy Plugin

Ship a new version of the MemoryLane Claude Code plugin.

## Allowed paths

Only these paths may have changes when deploying the plugin:

```
plugins/memorylane/
.claude-plugin/
```

Any changes outside these paths must be committed or stashed separately before deploying.

## Steps

### 1. Verify clean scope

Run `git status` and `git diff --name-only` to list all modified, staged, and untracked files.

If **any** changed file falls outside the allowed paths listed above, **stop immediately** and tell the user:

> Some changes are outside the plugin directory. Please commit or stash them before deploying the plugin.

List the offending files so the user can act on them.

### 2. Read current plugin version

Read `plugins/memorylane/.claude-plugin/plugin.json` and note the current `"version"` value.

### 3. Bump the version

Increment the **patch** number by default (e.g. `0.6.0` → `0.6.1`). If the user specified a version or bump level (major/minor/patch), use that instead.

Update the `"version"` field in `plugins/memorylane/.claude-plugin/plugin.json`.

### 4. Format

```bash
npm run format
```

### 5. Commit

Stage only plugin/marketplace files:

```bash
git add plugins/memorylane/ .claude-plugin/
git commit -m "plugin: v<new-version>"
```

### 6. Push

```bash
git push origin HEAD
```

### 7. Confirm

Print the new version and the pushed branch name so the user can verify.
