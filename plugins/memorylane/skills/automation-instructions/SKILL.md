---
name: automation-instructions
allowed-tools: AskUserQuestion, mcp__memorylane__browse_timeline, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: Write step-by-step automation instructions for a workflow, tailored to your tool (Claude, n8n or Zapier). Best run right after discover-patterns or process-analyst.
---

# Automation Instructions

Turn one workflow into clear, build-ready instructions for a specific automation tool.
Assumes it runs **after** `/discover-patterns` or `/process-analyst-new`, so it reuses
their output as the source and does NOT re-mine the timeline unless nothing is supplied.

## Step 1. Get the workflow (prefer prior output)

In priority order, do NOT re-derive what you already have:

1. **A pattern from `/discover-patterns`** (a selected pattern + its details) -> use it as-is.
2. **A process from `/process-analyst-new`** (a `process-analysis*.json` ledger, or a process
   the user points to) -> read that process's steps, apps, frequency, and automatable split.
   Glob `process-analysis*.json` in the working dir; if found, use it.
3. **A workflow the user describes in chat** -> use the description as-is.

Only if NONE of the above is available, fall back to mining: `search_context(query)` across
~30 days for instances, `browse_timeline` around the strongest matches for the full sequence,
and `get_activity_details(ids)` on 2 to 3 clear instances for exact steps. Keep it bounded.

## Step 2. Ask three things (one batched AskUserQuestion)

1. **Target tool** - Claude, n8n, or Zapier. Drives the whole output style.
2. **Constraints** - anything it must NOT do (no writes to prod, no emails to customers,
   human approval required, leave step X manual, etc.).
3. **Output format** - text, markdown, or JSON. **Assume markdown if skipped.**

Respect the constraints everywhere in Step 3, and call out any step the constraints force
to stay human.

## Step 3. Write the instructions (tailored to the tool + format)

Reconstruct the flow from trigger to done, separating **variables** (change each run, the
inputs) from **constants** (fixed, hardcoded). Then write it for the chosen tool:

- **Claude (Cowork / Skill)** - frame as Connect, Create, Run. Which apps to connect, the
  Skill/agent brief and the steps Claude runs, what it drafts vs writes, and the human
  approval gate before anything is sent or saved.
- **n8n** - the trigger node, the ordered nodes with the app/action and the data mapped
  between them, and error/retry handling. Deterministic, so any judgment step stays a
  human or AI-assist node.
- **Zapier** - the Trigger, then one Action per step (app + action + field mapping), plus
  any Filter or Path for branches. Note steps Zapier cannot do that need a human or code.

Render in the chosen format: **markdown** = the skeleton below; **text** = the same content
as plain prose, no markdown; **JSON** = one object `{ name, tool, trigger, variables[],
constants[], steps[{n, app, action, input, output, on_error}], human_steps[], constraints[] }`.

Markdown skeleton (keep it tight, drop empty sections):

```markdown
# [Workflow] - Automation instructions ([tool])

**Does:** [one line] **Trigger:** [what starts it] **Frequency:** [from the source]
**Constraints:** [what it must not do]

## Variables (inputs that change each run)

- [name]: [example]

## Constants (hardcoded)

- [name]: [value]

## Steps

1. [Action] in [app] - input [x] -> output [y]. On error: [fallback].
2. ...

## Stays human

- [step + why, incl. anything the constraints forced manual]

## Build notes ([tool])

- [trigger + key apps/nodes/actions + effort: easy/medium/hard]
```

## Step 4. Save and present

Ask where to save (default `~/Desktop/automation/[workflow-slug].md`, or `.txt` / `.json`
to match the format). Create the folder if needed. Then show the path and a 2-line summary
(tool, step count, key apps). Offer to do another workflow.

## Notes

- **Privacy** - never put passwords, API keys, or personal-message content in the output;
  keep only process-relevant details (app names, field labels, URLs).
- **Gaps** - if the source evidence is thin, say which steps are assumed and what the user
  should confirm before building.
