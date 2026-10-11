---
name: process-to-n8n
allowed-tools: AskUserQuestion, Read, Write, Glob, Bash, WebFetch, WebSearch, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: >
  (BETA) Build a working n8n automation from one process in a MemoryLane analysis,
  report or screen recording. Builds the actual workflow, not just instructions. One
  happy path, clear start and end, a person checks before anything changes. Use after
  process-analyst-new.
---

# Process to n8n (BETA)

Takes one process a team does by hand and gets a first version running in n8n. Best run right after `process-analyst-new`, but it works from a report, a description or a screen recording too.

Bar is 80/20. One path, happy path only, a person checks before anything is changed. Odd cases go back to a person and get logged. The team improves it from there.

Nothing here is tied to one company's systems. Every system, field, channel, approver and tool comes from the material or the user. Never assume a tool the material does not show.

## Done means

One made-up test record runs from start to finish in n8n, and the user holds a short recipe to set it up, test it and switch it on.

**Never end empty-handed.** Every run ends with a workflow and a recipe, in the same session. If something is missing, build around it with a marked placeholder and say exactly what is missing and who can supply it.

## How to talk to the user

The user is not technical. This applies to every message and every file.

- Very plain words. Short sentences. No jargon.
- Say "step" not node. "Test area" not staging. "Connect" not credentials. "A way for software to talk to it" the first time you say API.
- Steps as a numbered list, one action per step. Say what to click and what they should see after.
- No intros, no recaps, no filler.
- Questions always come with choices, your pick first.
- Say plainly what you know, what you guessed, and what is missing.

## Rules

1. **Material first, then ask.** Read everything available. Ask only for what n8n needs to run.
2. **Stop the user only three times.** Once to choose (Step 2), once to agree the plan (Step 5), once to test (Step 7). Batch questions, up to four per ask. Do not drip them.
3. **One path.** No branches in v1. Everything else goes back to a person.
4. **A person checks before anything is changed.** Judgment calls (medical, legal, money, anything about a person's care) always stay with a person. The automation gathers the facts, puts the decision in front of the person, and carries out what they decide.
5. **Safe by default.** The workflow is built switched off, with the steps that change records switched off too. Test only on made-up records.
6. **No personal data in any output.** Use field names, view names and page addresses. Never copy names, emails, health details or record values. Same strip and keep lists as `process-analyst-new` principle 9. Covers videos and documents too.
7. **Never ask for passwords or keys in chat.** The user connects each system inside n8n.
8. **Never trust memory for what a tool can do.** Check the official docs today (Step 4). If a page cannot be opened, mark it "not confirmed".
9. **Label what you know** as seen, reasoned, or guess.

## Step 1. Get set up (no questions yet)

Find the best starting material, in this order. Use what is there. Do not send the user away to make more.

1. `process-analysis.md` from `process-analyst-new`. Read the process entry: `steps`, `decision_points`, `common_path`, `what_varies`, `automation`, `connector_checks`, `reconciliation`, `systems_landscape`.
2. A MemoryLane report (HTML or PDF) the user uploads or points to.
3. The user's own description, a how-to doc, or a screen recording.

Then check quietly:

- **Captured data.** Is the screen data for the people who do this work reachable here (SQLite DB or MemoryLane tools)? Often it is not, because it sits on their computers. If not, say so in one line and carry on with the other material.
- **n8n.** Search this session's tools for "n8n". Note which of these they can do: look up steps, create a workflow, run a test.
- **Fit.** If the analysis says not to automate this, say why in two lines and offer the next best process. If the heart of the process is a judgment call, do not stop. Build the admin around it (rule 4). Stop only if nothing but judgment is left.

## Step 2. Stop one. Choose

One batched `AskUserQuestion`. Skip any question already answered.

1. **Which process**, if not given.
2. **Which path.** List the types of case this process handles (from `decision_points`, `what_varies`, the report). Count runs per type in code if the data allows and rank by runs times minutes. Put the top one first, marked "(Recommended)" with the count. With no counts, recommend the most common simple type and say it is a guess. The user can pick any or name their own.
3. **More material.** "Anything else I should look at?" Let them pick more than one.
   - "No, carry on"
   - "A how-to doc"
   - "A screen recording"
4. **n8n**, only if not connected. "Connect n8n to Claude now (Recommended)" or "Give me a file to paste in".

If they choose a screen recording, tell them exactly this, then wait for the upload:

1. Download the video as an MP4 file. A link will not work.
2. Copy the transcript as text, or download it.
3. Upload both here.
4. This needs Claude Cowork, where Claude can run code on your files. In normal chat, upload the transcript and screenshots of the key screens.
5. Use test records in the video if you can, so no real customer details show.

If they choose to connect, tell them:

1. In n8n, open **Settings**, then **Instance-level MCP**, and switch it on. Needs an n8n owner or admin.
2. Click **Connect**, pick **Claude**, choose one-click setup, sign in to n8n.
3. Say "done" here.

Guide: https://docs.n8n.io/connect/connect-to-n8n-mcp-server

If the n8n tools still do not show up in this chat, go the paste-in route. Do not wait or ask them to restart (that ends this session). Next time, connect before starting.

Then state what is in and what is out, one line each.

## Step 3. Read everything

**Captured data, if reachable.** `get_activity_details` on the evidence IDs for the chosen path, `search_context` for more runs. About 30 activities.

**Recordings.** The video and the transcript show different things. Use both.

- The video shows what is clicked. Run ffmpeg to save one picture every 3 to 5 seconds and read them in order. Skip pictures that look the same as the one before. About 60 pictures a video at most.
- If ffmpeg is missing, try to install it. If that fails, ask for screenshots of the key screens.
- The transcript gives the why, the rule the person follows, and the odd cases.
- Sound is not read from the video. No transcript means the rule is a gap.
- If the recording and the captured data disagree, note it for Step 5.

For each step of the path, pull:

- System and screen
- Buttons clicked and fields filled
- Fields read, fields changed, and the options seen for status style fields
- The view, filter or queue the work starts from
- What is looked up elsewhere and which ID links the systems
- What the record looks like when the work is finished

Write a **field map**: step, system, field read, field changed, link ID, source, basis (seen / reasoned / guess).

## Step 4. Check every tool against its official docs

Check each system in the field map, plus four n8n basics: the start event, the person check, the log, and what happens on an error. Open the live pages.

For each system, go down this list and stop at the first that works:

1. **n8n has a ready-made step.** Confirm the exact action: this read, this change, this start event. A step existing is not enough. Use the n8n tools' own step search if connected, else the official n8n docs (docs.n8n.io).
2. **No ready-made step, or it lacks the action.** Check the tool's own official docs for an API. Confirm the exact read or change and how to sign in. Use n8n's general web request step.
3. **The tool has an MCP server.** Check its docs and the n8n docs for whether n8n can call it. Use only if both are confirmed.
4. **None of these.** The step needs the screen. n8n cannot click buttons.

Notes:

- **In-house systems** have no public docs. Mark them "not confirmed" and ask in Step 5 if there is a way for software to talk to them, and who knows.
- **n8n docs pages move.** If a page is missing, use docs.n8n.io/sitemap.md or the site search. Do not give up on the first dead link.
- For the n8n basics, confirm: a send-and-wait step for the chosen channel, how to switch a single step off, where to keep the log (an n8n data table or a sheet), and how a failed step can alert a person.

Fix the field map with the names the docs use. Names on screen often differ.

Write a **tools checked** table: system, action needed, how n8n will do it, docs page, date, confirmed (yes / no). Anything not confirmed is a gap and is never built as if it works.

If the whole process needs the screen, stop and say n8n is the wrong tool.

## Step 5. Stop two. Agree the plan

Show one short plan, under 20 lines. Fill in everything you can so the user mostly says yes.

- **Starts when.** One exact event (a new record in a named view, a status change, a set time).
- **Steps.** Numbered, one line each.
- **The rule.** Written as plain if-this-then-that on fields. If it cannot be written that way, the person decides at the check and the automation does not try.
- **Person checks.** Where, who, and at which point. Recommend the place the team already works, chosen from the channels Step 4 confirmed. Default point is right before the first change. Default approver is the person who does the work today. The check message shows the proposed change and a link to the record, not personal details.
- **Ends as** one of four, each with the record state that proves it:
  - Done
  - Handed to a person (not a simple case, or the check said no)
  - Failed (a system error, then tell a person and hand back)
  - Waited too long (no answer in one working day, then hand back)
- **Steps that need the screen**, if any.
- **What I still need.**

Then ask what is still open with `AskUserQuestion`. Only what applies. If more than four, ask the rest straight after.

- Is the plan right? (yes / change something)
- Where should the person check happen? (your pick first, other confirmed channels after)
- Is the rule right? Offer your best reading as the first choice.
- **Screen steps.** "Keep with a person for now (Recommended)", "We have a tool that clicks through screens", "Not sure".
- **In-house systems.** "Yes, software can talk to it", "No", "Not sure, ask our n8n person".
- Anything the recording and the data disagreed on.

Do not ask about access here. That goes in the recipe as a thing to do.

**If they name a screen tool:** check its official docs for how n8n can start a job and get the result back. If confirmed, plan it as one step: n8n sends the job, waits, reads the result, and hands back to a person on failure. If not confirmed, keep the step with a person and say why.

**Gap list.** Write every open item as: what is missing, why n8n needs it, who can answer, status. An open gap becomes a hand back to a person or a marked placeholder. Never a silent guess.

Save a first draft of the recipe now, so nothing is lost if the session ends.

## Step 6. Build

Shape: start, fetch the record, check the rule, person checks (send and wait), re-check the record is still unchanged, make the change, log.

- **Get the format right first.** If the n8n tools offer a build guide, best practices or step details, read them before writing anything. If they can read workflows, look at one existing workflow to copy the exact format. Otherwise take step types and settings from the docs pages you opened.
- Use only what the tools checked table confirmed.
- Keep it small. Fewest steps that do the job. No clever code where a plain step works. No AI steps in v1.
- **Add a test start.** A second, by-hand start that feeds in the test record, so the user can test with one click while the workflow stays off.
- **Switch off every step that changes a record.** The check message still shows what would be changed.
- Not a simple case: tell the person, leave the record alone, add a row to the log.
- A step fails: tell the person, add a row to the log, leave the record alone.
- The log holds record links and reasons, not personal details.
- Name every step after what it does, in plain words.
- Placeholders are named `FILL IN` plus what goes there.
- **Explain it inside n8n.** One sticky note at the top (what this does, when it starts, how it ends, who checks, what stays with a person). One beside each group of steps.

Deliver it:

- n8n connected and able to create workflows: create it in n8n, switched off.
- Otherwise: write `workflow.json`. Check in code that it is valid JSON and holds no keys or sign-in details.
- Hand the recipe and any file to the user (send them, or save to their folder).

## Step 7. Stop three. Test and hand over

Tests use made-up records only. Tell the user exactly which records to create and what to put in each field, from the field map. An existing test account is fine too.

1. **Dry test.** Change steps stay off. Run one made-up simple case. The user checks the proposed change in the check message is right. Then run one made-up case that should be handed back, and check it lands in the log.
2. **Live test.** Switch the change steps on. Run the simple case again. Check the record ends as "Done".

With n8n connected, run what you can and report pass or fail. The n8n tools may not be able to run a workflow that waits for a person. If so, test up to the check yourself and give the user the last part as numbered steps.

Without n8n connected, the user runs both tests from the recipe.

If a test fails, fix it and run again. If it cannot be fixed here, say what blocks it and who can unblock it.

After go-live: when the same odd case shows up three or more times in the log, run this skill again for that case.

## Outputs

Short and plain. No extra files.

1. **The workflow.** In n8n, switched off. Or `workflow.json`.
2. **Automation recipe** (`automation-recipe.md`). The top part is for the user and fits one screen. The bottom part is for the person who runs n8n.

   Top part:
   - What it does, in two lines
   - When it starts and how it ends
   - What stays with a person
   - **Set it up.** Numbered. Mark each step with who does it (you, or the person who runs n8n).
     - Paste-in route: open a new workflow in n8n, copy everything in `workflow.json`, click the canvas, paste. Or use the workflow menu, then Import from File.
     - Connect each system inside n8n.
     - Fill each `FILL IN`.
   - **Test it.** The dry test, then the live test, with which made-up records to create, what to click, and what the user should see.
   - **Switch it on.** Only after both tests pass. Switch on the change steps, then the workflow.
   - Where odd cases land
   - **What is still missing** (the gap list)

   Bottom part:
   - **If paste does not work, build it by hand.** A table of every step in order: name, type, what to set.
   - **Tools checked** (the table from Step 4)
   - Brief for any step that needs the screen: start screen, each click and field in order, end screen, how to tell it worked, runs per month
   - Numbers to beat (`reconciliation`: minutes per run, runs per year), if known

3. **Notes inside n8n.** The sticky notes. The recipe also pastes into any other doc tool as is.
4. **Chat summary.** One-line bullets, five at most:
   - What was built
   - What stays with a person
   - What is still missing and who has it
   - Where the files are
   - The next step
