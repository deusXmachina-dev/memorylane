---
name: build-n8n-workflow
allowed-tools: AskUserQuestion, Read, Write(./workflow.json), Write(./n8n-recipe.md), Glob, WebSearch, WebFetch(domain:docs.n8n.io), mcp__memorylane__search_context, mcp__memorylane__get_activity_details, mcp__memorylane__get_db_path, mcp__plugin_memorylane_memorylane__search_activity, mcp__plugin_memorylane_memorylane__get_activity_details, mcp__plugin_memorylane_memorylane__list_organizations, mcp__plugin_memorylane_memorylane__list_teams, mcp__plugin_memorylane_memorylane__list_devices
description: >
  (BETA) Turn one process from a MemoryLane analysis, report or screen recording into a
  simple working n8n workflow, plus a short recipe to test and publish it. Builds the
  workflow in n8n when connected, else a file to paste in. One happy path, fewest steps.
  Use after analyze-processes.
---

# Process to n8n (BETA)

Takes one process a team does by hand and gets a first version running in n8n.

Bar is 80/20. One path, happy path only, fewest steps that work. Odd cases stay with a person. The team improves it from there.

Every system, field, channel and approver comes from the material or the user. Never assume a tool the material does not show.

## Done means

The user has the workflow (in n8n, or as `workflow.json`) and a short recipe to connect it, test it on one made-up record, and publish it. Unless the process should not be automated, every run ends with that, in the same session. If something is missing, put a `FILL IN` placeholder and say who can supply it.

## Keep it simple

Simple is the goal. A small workflow the team understands beats a safe one nobody uses.

- **One safety net: unpublished.** The workflow is built as a draft. Drafts do not run on their own, so real work is untouched until someone clicks **Publish**. Do not add switched-off steps, re-checks, custom logs, error workflows or timeout paths on top. n8n's **Executions** list already shows every run and its errors.
- **A person check only where a person decides today** (approves, judges, signs off money, anything about a person's care). Use a send-and-wait step in the place the team already talks. If nobody decides today, add no check.
- **Two endings.** Done, or left alone (the record does not fit the rule, so the workflow stops and the team handles it as today). Nothing else.
- **No code or AI steps** where a plain step works.
- **Fewest steps.** Before handing over, try to remove each step. If the process still works without it, remove it.

## How to talk to the user

The user is not technical.

- Very plain words. Short sentences.
- Say "step" not node, "connect" not credentials, "a way for software to talk to it" the first time you say API.
- Steps as a numbered list, one action each. Say what to click and what they should see after.
- No intros, no recaps. Questions come with choices, your pick first.
- Say plainly what you know, what you guessed, and what is missing.

## Rules

1. **Material first, then ask.** Ask questions only at Step 2 and Step 4, up to four per ask. Waiting for an upload or a connection is fine.
2. **No personal data in any output.** Use field names, view names and page addresses. Never copy names, emails, health details or values from real records. Same strip and keep lists as `analyze-processes` principle 9.
3. **Never ask for passwords or keys in chat.** The user connects each system inside n8n.
4. **Never publish the workflow yourself.** The user does that after the test.

## Step 1. Read everything (no questions yet)

Use what is there, in this order:

1. A `process-analysis*.md` file from `analyze-processes` (glob for it; on multi-person runs there is one per role, so use the one with this process): `steps`, `decision_points`, `common_path`, `what_varies`, `automation`, `reconciliation`.
2. A MemoryLane report the user points to.
3. The user's description, a how-to doc, or a screen recording.

Also:

- **Captured data**, if MemoryLane tools are here (`${CLAUDE_PLUGIN_ROOT}/references/data-sources.md` has the local and remote tool names): `get_activity_details` on the evidence IDs, `search_context` for more runs.
- **Recordings:** save one picture every 3 to 5 seconds with ffmpeg (it asks for approval) and read them in order, skipping repeats (about 60 max). The transcript gives the rule and the why. If you cannot run code here, ask for screenshots of the key screens.
- **n8n connection:** if n8n tools are connected, note whether they can create a workflow.

For each step note: system, fields read, fields changed, the view or queue the work starts from, the ID that links systems, and what "finished" looks like on the record.

If the analysis says not to automate this, say why in two lines and offer the next best process.

## Step 2. Stop one. Choose

One `AskUserQuestion`. Skip anything already answered.

1. **Which process**, if not given.
2. **Which path.** The types of case this process handles. Recommend the most common simple one first, with run counts if the data has them.
3. **Anything else to look at?** Only if the material is thin. "No, carry on" / "A how-to doc" / "A screen recording".
4. **n8n**, only if not connected. "Connect n8n to Claude now (Recommended)" / "Give me a file to paste in".

If they pick a recording, ask for the MP4 file and the transcript (a link will not work), then wait for the upload.

If they pick connect, tell them:

1. In n8n, open **Settings > Instance-level MCP** and click **Enable MCP access**. Needs an n8n owner or admin.
2. Click **Connect**, pick Claude, follow the steps, and approve access in n8n.
3. Say "done" here.

If the n8n tools still do not show up, use the paste-in route. Do not ask them to restart (that ends this session).

## Step 3. Check the docs

Check the official docs today, not memory. For each step, take the first that works:

1. **n8n has a ready-made step** with this exact action (this read, this change, this trigger). Use the n8n tools' own search if connected, else docs.n8n.io.
2. **The tool has an API** that does it (its official docs). Use n8n's HTTP Request step. For in-house tools with no public docs, ask in Step 4 who would know.
3. **Otherwise it stays with a person.** n8n cannot click through screens.

Docs outside docs.n8n.io may ask for approval. If a docs page moved or a fetch is refused, use WebSearch. If you still cannot confirm a step, mark it "not confirmed" and leave it with a person. If the step that does the real work stays with a person, say n8n cannot help with this process and offer the next best one.

## Step 4. Stop two. Agree the plan

Under 10 lines:

- **Starts when.** One exact event.
- **Steps.** Numbered, one line each.
- **The rule.** Plain if-this-then-that on fields.
- **Who checks**, only if someone decides today: who, where, and right before which change.
- **Stays with a person.**
- **Missing.** Each item with who can answer.

Ask with `AskUserQuestion`: is the plan right, and anything still open.

## Step 5. Build

- If the n8n tools offer a build guide or step details, read them first. Otherwise take step types and settings from the docs pages you opened.
- Name every step after what it does, in plain words.
- n8n tools can create workflows: create it in n8n and leave it unpublished.
- Otherwise: write `workflow.json`. Check in code that it is valid JSON and holds no keys.

## Step 6. Hand over

Write `n8n-recipe.md`. Short. Sections:

1. **What it does.** Two lines.
2. **Set it up.** If you got a file: open a new workflow, click the canvas, paste the contents of `workflow.json`. Then connect each system inside n8n and fill each `FILL IN`.
3. **Test it.** A test run makes real changes, so it must only touch a made-up record.
   1. Create one made-up record (name it `TEST ...`, with the tester's own email on it). Say what to put in each field.
   2. Open the first step that reads records (not a schedule step), run it alone, and pin its output (pin icon). If it also shows real records, edit the pinned output and delete all but the `TEST` record. The full run now uses only that record.
   3. Click **Execute workflow**. Say what they should see at the end.
4. **Publish.** Click **Publish** at the top right. Next morning, open **Executions** and check the runs worked.
5. **Missing.** What and who.

Then a chat summary, three bullets: what was built, what stays with a person, the next step.
