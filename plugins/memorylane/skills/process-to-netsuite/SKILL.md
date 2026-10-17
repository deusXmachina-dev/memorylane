---
name: process-to-netsuite
allowed-tools: AskUserQuestion, Read, Write, Glob, Bash, WebFetch, WebSearch, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: >
  (BETA) Turn one process from a MemoryLane analysis, report or screen recording into a
  simple NetSuite automation (SuiteFlow, plus a script only where needed), with a
  short recipe to build, test and switch it on. One happy path, fewest steps.
  Use after process-analyst-new.
---

# Process to NetSuite (BETA)

Takes one process a team does by hand in NetSuite and gets a first version running inside NetSuite.

Bar is 80/20. One path, happy path only, fewest steps that work. Odd cases stay with a person. The team improves it from there.

Every record type, field, list, role and approver comes from the material or the user. Never assume a feature, custom field or SuiteApp the material does not show.

## Done means

The user holds a short recipe to build the automation, test it on one made-up record, and switch it on. Unless the process should not be automated, every run ends with that, in the same session. If something is missing, put a `FILL IN` placeholder and say who can supply it.

## Keep it simple

Simple is the goal. A small automation the team understands beats a safe one nobody uses.

- **One safety net: Testing status.** A NetSuite automation set to **Testing** starts only for its owner, so real work is untouched until it is set to **Released**. Do not add go-live switches, re-checks, custom logs, alerts or timeout paths on top. NetSuite's workflow history and script error emails already cover that.
- **A person check only where a person decides today** (approves, judges, signs off money). Use the record's built-in approval if it has one. If nobody decides today, add no check.
- **Two endings.** Done, or left alone (the record does not fit the rule, so the automation does nothing and the team handles it as today). Nothing else.
- **Fewest steps.** Before handing over, try to remove each step. If the process still works without it, remove it.

## How to talk to the user

The user is not technical.

- Very plain words. Short sentences.
- Say "automation" not SuiteFlow workflow, "script" not SuiteScript, "list" not saved search. Give the NetSuite name once in brackets, then the plain word.
- Steps as a numbered list, one action each, with the exact menu path (for example **Customization > Workflow > Workflows > New**) and what they should see after.
- No intros, no recaps. Questions come with choices, your pick first.
- Say plainly what you know, what you guessed, and what is missing.

## Rules

1. **Material first, then ask.** Ask questions only at Step 2 and Step 4, up to four per ask. Waiting for an upload or a connection is fine.
2. **No personal data in any output.** Use record types, field IDs and list names. Never copy names, emails or values from real records. Same strip and keep lists as `process-analyst-new` principle 9.
3. **Never ask for passwords, tokens or keys in chat.**
4. **The NetSuite connection only reads** (field IDs, lists, record shapes). Never create or change records with it. It cannot build the automation; the user copies it into NetSuite from the recipe.

## Step 1. Read everything (no questions yet)

Use what is there, in this order:

1. `process-analysis.md` from `process-analyst-new`: `steps`, `decision_points`, `common_path`, `what_varies`, `automation`, `reconciliation`.
2. A MemoryLane report the user points to.
3. The user's description, a how-to doc, or a screen recording.

Also:

- **Captured data**, if MemoryLane tools are here: `get_activity_details` on the evidence IDs, `search_context` for more runs. NetSuite page addresses show the record type (`/app/accounting/transactions/vendbill.nl`).
- **Recordings:** save one picture every 3 to 5 seconds with ffmpeg and read them in order, skipping repeats (about 60 max). The transcript gives the rule and the why. If you cannot run code here, ask for screenshots of the key screens.
- **NetSuite connection:** check this session's tools for NetSuite (`ns_` tools). If there, look up field IDs, the list the work starts from, and status values.

For each step note: record type, fields read, fields changed (with IDs), and what "finished" looks like on the record.

If the analysis says not to automate this, say why in two lines and offer the next best process.

## Step 2. Stop one. Choose

One `AskUserQuestion`. Skip anything already answered.

1. **Which process**, if not given.
2. **Which path.** The types of case this process handles. Recommend the most common simple one first, with run counts if the data has them.
3. **Anything else to look at?** Only if the material is thin. "No, carry on" / "A how-to doc" / "A screen recording".
4. **NetSuite connection**, only if not connected. "Connect NetSuite to Claude now (Recommended)" / "I'll copy the automation into NetSuite myself from the recipe".

If they pick a recording, ask for the MP4 file and the transcript (a link will not work), then wait for the upload.

If they pick connect, tell them (check the steps against Oracle's current "NetSuite AI Connector Service" guide first):

1. A NetSuite admin installs the **MCP Standard Tools** SuiteApp.
2. In Claude, add a custom connector with the address Oracle gives for your account.
3. Sign in to NetSuite with a role that can see this process and has the **MCP Server Connection** permission.
4. Say "done" here.

If the NetSuite tools still do not show up, use the copy route. Do not ask them to restart (that ends this session). On the copy route, use standard field IDs from the Records Browser and a `FILL IN` for any custom field ID.

## Step 3. Check the docs

Check the official Oracle docs today, not memory. For each step, take the first that works:

1. **NetSuite already does it** (built-in approval routing, dunning letters to customers, list email alerts, memorized transactions). Note any feature or preference that must be switched on.
2. **No-code automation** (SuiteFlow): confirm the trigger and the action exist for this record type.
3. **Script** (SuiteScript 2.1), only if SuiteFlow cannot. Prefer a small action script called from the automation.
4. **Otherwise it stays with a person.**

Sources: Oracle NetSuite Help Center (docs.oracle.com/en/cloud/saas/netsuite/) and the SuiteScript Records Browser for field IDs. Use the Help Center search if a page moved. If you cannot confirm a step, mark it "not confirmed" and leave it with a person.

## Step 4. Stop two. Agree the plan

Under 10 lines:

- **Starts when.** One exact event.
- **Steps.** Numbered, one line each.
- **The rule.** Plain if-this-then-that on fields.
- **Who approves**, only if someone decides today.
- **Stays with a person.**
- **Missing.** Each item with who can answer.

Ask with `AskUserQuestion`: is the plan right, and anything still open.

## Step 5. Build

If a built-in feature covers the whole path, build nothing. The recipe just lists the settings to switch on.

- Automation and any script deployment set to **Testing**. **Enable Logging** on, so runs show in workflow history.
- Name every state, action and script after what it does, in plain words.
- Any script: one short `.js` file, comment at the top saying what it does. Check it parses (`node --check`) and holds no keys.

## Step 6. Hand over

Write `netsuite-recipe.md`. Short. Sections:

1. **What it does.** Two lines.
2. **Build it.** Numbered clicks for the admin: each state, action and condition, with the screen and value. Any script: upload the file, create the script record, deploy it. Each `FILL IN`.
3. **Test it.** The automation's owner creates one made-up record (name it `TEST ...`, with their own email on it). Say what to put in each field, what to click, and what they should see in workflow history. Testing status only starts for the owner, so anyone else will see nothing happen. A scheduled automation does not run on its own in Testing: add a condition so it only matches the `TEST` record, click **Execute Now**, then remove the condition. Otherwise it runs on real records.
4. **Switch it on.** Set the automation and any script deployment to **Released**.
5. **Missing.** What and who.

Then a chat summary, three bullets: what was built, what stays with a person, the next step.
