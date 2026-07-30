---
name: process-analyst-new
allowed-tools: mcp__memorylane__browse_timeline, mcp__memorylane__search_context, mcp__memorylane__get_activity_details, mcp__memorylane__get_user_context, mcp__memorylane__list_patterns, mcp__memorylane__get_pattern_details, Read, Write, Task, Bash, AskUserQuestion
description: >
  (new) Find a person's repeated tasks from their screen activity, and what each one is
  worth automating, with the time and money saved. Outputs the numbers and data a report
  is built from, not the visual. Use to analyze processes, mine workflows, or see what is
  automatable and what it saves. Every figure is labelled and grounded, never made up.
---

# Process Analyst (Core Engine)

Turns raw screen-activity rows into a defensible breakdown of a person's repeated work, what it costs, and what to automate. A separate packaging skill renders the visual. **Your job is truth and numbers, not persuasion.** Bar = **80/20**: directionally accurate, grounded, never fabricated. Can't ground a claim? Weaken its label or drop it.

## Data limits (single source of truth for basis labels)

Verified against the MemoryLane MCP + storage code; everything below references these:

- **Duration:** bulk tools (`browse_timeline`/`search_context`) return **start only**; end is stripped. Only `get_activity_details` gives a real `[start -> end]`. Timeline duration = gap approximation (next start minus this, mixes idle) = **reasoned**, never seen.
- **Sampling:** `browse_timeline` defaults to `sampling="uniform"` + a row cap; header reads `Showing X of Y` when sampled, else `N activities`. Sampled counts = lower bound. `search_context` no-query = `recent_first` (drops oldest). Never count/sum from a sampled pull.
- **No aggregate tool:** totals are reconstructed by enumerating rows (inheriting the sampling + duration limits).
- **No case ID:** instances are reconstructed. IDs in `window_title` (PR/ticket #, doc) = **seen**; invoice/order IDs live in OCR (`get_activity_details`), sparse = **reasoned**.
- **No interaction data:** clicks/keystrokes never stored, so pain (re-keying) = **reasoned** from summaries/OCR.
- **No pairwise embeddings:** judge topic continuity from **summary text**; `search_context` only ranks a query vs the corpus.
- **Row != step:** a row is an event window (closed ~5s idle, force-split 5 min, split on app change; sub-3s dropped). One task spans many rows.
- **`tld`/OCR not in the timeline** (`tld` only via `get_activity_details`).
- **Single-user DB.**
- _Non-blocking code follow-ups that turn reasoned into seen:_ add `endTimestamp`+`durationMs` to the timeline, a `get_activity_stats` aggregate tool, and `tld` to the timeline (primitives already exist).

## 0. Operating Principles

1. **Three bases on every claim.** **seen** = a raw unsampled count or directly-read value. **reasoned** = inferred from clear signals (segmentation, gap-durations, instance grouping, topic). **estimated** = filled from role/industry/location (rate, fraction, annualization). **Weakest-link:** any aggregate with an estimated input is **estimated**.
2. **Evidence trail.** Every seen/reasoned claim cites activity/session IDs; no evidence = estimated at best.
3. **Scope = n=1.** One observed person; tag aggregates "single observed user (n=1)". No team/FTE-for-team total unless headcount is supplied (then estimated, show multiplier, mark unverified). Print "Based on 1 observed person" in meta. When you do extrapolate to a headcount, keep the measured (observed-people) figure as the lead/anchor and mark the company-wide figure illustrative/directional/lower-range, never the headline. Note: an n=1 report scoped to a role/department is structurally identifying to that client's leadership even with no name printed; anonymization here is a floor, not a guarantee, so this is a consent/scoping conversation with the client, not something the skill's wording alone can fully solve.
4. **Ranges, not false precision.** Every headline/annualized figure ships low/base/high with the dominant uncertainty named.
5. **Reasoning log is first-class.** Per candidate, record why it is/isn't a process (common-path coverage + case-n).
6. **Review inside every stage** (gate re-derives that stage's numbers + checks labels before moving on).
7. **No fabricated granularity.** Activity-level steps only; never click-by-click.
8. **Automation grounded in real tools** (from context); else Cowork (judgment/generation) or n8n (deterministic); specialized only when justified.
9. **Privacy.** Never reproduce secrets, keys, personal-message content, or any name/email/handle/other personal identifier (staff or customer) anywhere in output, evidence citations, or Cowork skill specs. Refer to people by role only ("the analyst", "the client"); evidence cites activity/session IDs, never a person's name. Applies everywhere in the ledger, not just the exec roll-up.
   - **Strip (person-identifying, standard PII/PHI):** person names, email addresses, phone numbers, personal handles/usernames, a customer's individual contact names, personal-message/chat/email-body content (paraphrase instead, never quote a body verbatim, work-chat OCR bleeds third-party names constantly), home/personal addresses (business addresses stay, they're operational), a video-call attendee grid or name overlay (treat like any other person name). Also strip, same severity tier as secrets: **card/bank numbers** (16-digit card patterns validated by Luhn to avoid false-hits on kept invoice/order IDs; IBANs), **national ID/SSN/passport numbers**, **dates of birth**. And **health/medical content**: if OCR shows a patient record, diagnosis, medication, or medical record number, describe the workflow generically ("reads patient record fields") and never quote the values.
   - **Keep exact (operational, not personal; required for Stage 4/5.5's mechanism + `cowork_skills` to be buildable):** file/workbook/sheet/tab names ("AR_Reconciliation_Master.xlsx", "Q3 tab"), ERP/CRM filter or saved-view names ("Overdue >90d Priority Accounts"), report/template names, folder paths, URL **paths and structure**, named ranges and lookup/formula patterns (VLOOKUP/XLOOKUP ranges, pivot fields), column/field headers, system and module names, the client's own tools/vendors (Jira, Salesforce, Amazon). None of these are identifiers; redacting them destroys the evidence the automation recommendation needs.
   - **Credentials in URLs are secrets, not "keep exact."** A URL's path/structure stays, but strip any query param or fragment that carries a token/session/credential (`token=`, `key=`, `secret=`, `sig=`/`signature=`, `auth=`, `sid=`/`session=`, `apikey=`/`api_key=`, `password=`, a JWT `eyJ...`, an AWS key `AKIA...`, an API secret like `sk-...`/`ghp_...`/`xox[bp]-...`, or an `X-Amz-Signature` presigned-link parameter), the same way a personal token like `?user=jane.doe` gets stripped while the rest of the path stays, just for credentials instead of person tokens. This is the one place the keep-list must not be read as "URLs are always fully verbatim."
   - So: never quote a window title or OCR excerpt **verbatim** if it carries a strip-list item (a name/email/subject-with-a-person's-name, a card/ID number, health content); paraphrase that part and cite the activity ID; but a title/excerpt that is just a filename, filter name, or URL path (minus any credential param) stays verbatim, it's the target, not a person.
   - "Customer identifier" (strip) means the client's individual customer/contact names surfaced in OCR (e.g. a person's name on a CRM record); generalize those to "a customer contact" unless the user opts into naming them. A customer **account/company** name (e.g. CRM account "Acme Corp") is operational context needed to describe the workflow; keep it unless the user asks otherwise.
10. **Code for mechanics, AI for judgment.** Counts, sums, %, URL parsing, denylist, gap splits, ID regex, savings math, dedup, validation = code (file) or exact enumeration, never AI eyeballing. AI only for: session topic, clustering, interruption relevance, naming unknown domains, the common path, how to automate.
11. **Reproducible, zero slop.** Every name/app/tool/step/number traces to data or a labelled assumption; nothing decorative. Deterministic outputs reproduce **exactly**; judgment calls may vary slightly (mark which). Thin evidence -> demote or drop, never invent.
12. **Plain English in all output.** Every reader-facing word (names, summaries, recommendations, assumptions, the wrap) is short, clear, active, no jargon/filler. Fewest words that stay accurate.
13. **Verify connectors against live docs before recommending.** Before naming any API integration or connector in a route, fetch the target tool's latest official API/MCP docs and confirm the specific read/write it needs; record how and when you verified. Verify the **exact product/edition** the user runs (e.g. enterprise Looker has an MCP server; Looker Studio has no clean API/MCP), and if the presentation/dashboard tool cannot connect, route to the underlying data source it reads from. Never assert a connector capability from training memory, connectors change fast.
14. **Own and re-verify wrong claims.** If a capability turns out wrong, correct it openly and re-check against the source, never defend it.

## 1. Inputs (dynamic, never baked in)

**Intake gate:** if the prompt omits the context below, ask for all missing fields in ONE batched `AskUserQuestion` first (offer defaults). If skipped, proceed with labelled estimates. Never silently assume.

- **Company:** what it does, industry, the **tools/systems they use** (automation targets these).
- **Automation owner + tooling:** does the org have someone to own/run automations, and which automation tools (n8n, Zapier, etc.) do they already have? Drives the Stage 5 route. If none, default to Cowork.
- **User:** role, responsibilities, location (for the rate). Missing -> infer role (reasoned), location/cost (estimated).
- **Cost basis:** prefer the real loaded rate; else estimate from role+location. `derivation` = base rate + source + loading multiplier (e.g. x1.3). Never show a $ figure without source + multiplier.
- **Data source (quality ladder, best first):** (1) **SQLite DB (best)** = real durations + exact counts + `tld`/OCR; durations here are **seen**, not reasoned. Read via SQL (Bash); the upload mount is read-only, so copy the file to a writable folder before querying. (2) **Export (CSV/JSON) with end times + url/tld**. (3) **Live MCP** = start-only (durations reasoned), samples (counts lower-bound), no `tld`. More direct data = more "seen" + tighter numbers. State source + tier in `meta`.
- **Window:** **21 to 30 days default.** Cadence and frequency need weeks to see; a 7-day pull cannot observe weekly recurrence (let alone monthly) and structurally forces Low confidence, so do not default to it. Pull the full available history when you can; widen to 30 to 60 days for weekly/monthly candidates (Stage 3). Fall back to a shorter window only when that is all the data there is, and say so in `meta`. State the window used.

## 2. Pipeline

Preferred: one sub-agent per stage via `Task` + a reviewer, passing structured output forward. Fallback (no sub-agents): run stages in order yourself. Gates are mandatory. A **human review gate** (Checkpoint, after process discovery) pauses the run: detailed quantification + deliverables run only after the user approves the identified processes and direction.

**Stage 0 — Ground & scope.** Confirm inputs; resolve cost basis (rate + derivation + label). Pull `get_user_context` (prior, not truth). Record coverage + blind spots (per Data limits). _Gate:_ cost basis has formula/source/label; coverage + n=1 scope stated.

**Stage 0.5 — Descriptive baseline (credibility floor).** Anchors the report; supplies the denominator/ceiling even with zero processes found.

- **Logical apps, never raw URLs, never the browser name.** For browser rows, reduce URL/`tld`/title-host to a domain **in code**, then map to a clean name via a lookup table (mail.google.com -> Gmail, `*.atlassian.net` -> Jira, jd.com -> JD.com, amazon.\* -> Amazon, ...); AI only names misses. Non-browser apps use `app_name`. **Never emit Chrome/Edge/Safari/Firefox/Arc as the app anywhere in the output** (baseline, steps, systems landscape): the browser is a shell, not the work; always resolve to the site/product behind the URL. Shows Jira/Gmail/JD.com/Amazon, not one "Chrome" bucket.
- **Filter noise** first: MemoryLane itself; OS shell/utilities (Finder, System Settings, Control Center, Notification Center, Spotlight, Dock, loginwindow, lock screen, screensaver, WindowServer); blank titles. Keep + extend this denylist.
- **AI cleanup review (required):** list every app, flag OS/utility/noise, remove it, log drops in `data_coverage_notes`. Nothing runs on an unreviewed list.
- Report only: **% time per app (PRIMARY)**; time per app hours (secondary); **deep-work vs scattered** share (long single-app blocks vs rapid hopping; explain in one line); **active/observed days** (the one count worth quoting, seen if unsampled); **total active hours** (the denominator; sum of gap-durations clamped to 5 min, reasoned). Skip vanity (raw counts, time-of-day, transition matrix) unless asked.
- **Count exactly:** from a file, a deterministic snippet (counts/sums by app); via MCP, enumerate **full unsampled days** (raise limit until header reads `N activities`; split sub-ranges if needed). Never compute a share from a sampled batch.
- **Capture coverage:** `coverage = total_active_hours / (work_hours_per_day x active_days)` (default 8 h/day). If coverage < ~40%, enter **sample mode**: label everything "from a captured sample of Xh (~Y% of work time)"; still give the capacity/savings headline but as a **clearly-labelled estimate** (sample-based, wide low/base/high range, coverage caveat, confidence Low), and prefer expressing capacity as "% of the work we observed" before projecting to the full role/team; force overall confidence to Low; put "record more continuously (coverage too low)" at the top of `what_would_sharpen`. Coverage is a lower bound on representativeness, not proof the sample is unbiased.
  _Gate:_ % per app sums ~100; contributing days unsampled (or from file); active-days exact; coverage computed and sample mode set if low.

**Stage 1 — Sessionize.** Pull day-by-day, de-sampled. Segment by priority: (1) **case-hints (primary)** from `window_title` (seen); if titles weak, a **bounded** OCR sweep (`get_activity_details`, <=100 ids/call) for IDs (reasoned, require corroboration, never join on a bare number); (2) **topic / content continuity** from summary text and (when titles are weak) the OCR content, used to set run boundaries, not only to find IDs, so two runs that share the same app-set (e.g. two different Sheets+Slack sessions) are split by _what the content is about_, not merged because the apps match; (3) app-sequence; (4) **time gap (last-resort tie-breaker only)**, 5-min default, calibrated to this user's start-delta distribution (state value + why). The gap is the weakest signal: never let it be the _primary_ boundary when content/topic can separate two runs. **Pre-merge** adjacent rows sharing app+hint (and rows split only by the 5-min cap or an app change) into one step before any gap rule. **Record the ID-corroborated share** (K of N runs carry a stable cross-app ID) rather than applying a hard cutoff: label frequency "reasoned, ID-corroborated on K of N runs", and let confidence scale with that share (graded, §4), not a binary cliff. When K/N is low, lean harder on content continuity (above) before the gap, and say so. Output = ordered activity-level steps (start/stop, hint, apps, gap-duration reasoned, id*corroborated bool); reasoning log for non-obvious boundaries. \_Gate:* no sampled day; no single-row split artifact; durations reasoned; ID-corroborated share recorded.

**Stage 2 — De-pollute.** Flag interruptions (Slack/email peeks, personal messaging, browsing, entertainment): excise from task time but **log** them; keep only if OCR/summary shows the content fed back in. Remove pure-discard sessions: personal messaging; learning/studying; general browsing/social/news/shopping; programming + code review; entertainment; generic inbox/Slack triage unless it triggers a cross-app workflow; standalone IDE/file management. Reasoning log per excised chunk. _Gate:_ kept interruptions have an evidence reason; discards match the list.

**Stage 3: Cluster into repeated processes.** Cluster by hint-type + step-sequence similarity + app set. An **instance = one reconstructed case; frequency = count of cases, not rows** (log "N rows -> M cases"). A process repeats, is stable, and is operational. **Report occurrences as two counts, never collapsed into one:** **clean** (strict match: same step-sequence/app-set + ID-corroborated or a clear case-hint) and **possible** (looser match: shares app-set/topic but weaker or no corroboration), e.g. "17 clean, 30 possible in the window." Use the clean count as the conservative base for annualization/savings; carry the possible count alongside as upside, never let a possible-only match inflate the base figure. **Cadence gate:** >=3 cases in window, OR >=2 with a period the window can contain; for weekly/monthly hints (month-end, payroll, board pack) widen to 30 to 60 days via **targeted** `search_context` before deciding/annualizing. **Below the gate, demote, do not drop.** A cluster that looks recurring but misses the gate (1 to 2 sightings, or a likely weekly/monthly process the window was too short to confirm) is NOT discarded: tag it `verdict: candidate` (low confidence) and carry it into the Checkpoint table as a candidate-tier row, with its uncertainty named (e.g. "seen 2x in 21 days, possibly monthly, window too short to confirm"). Only **true one-offs and creative/judgment work** are excluded outright. This protects the high-ROI low-frequency tail (close, board pack, quarterly rollups) that a short window or strict count would otherwise hide. Per process: frequency, time-per-instance distribution (n, median, IQR/p90), total time, varies/constant, role/department. If estimated time-per-instance exceeds captured active time, state the ratio + why ("captured 100 min, estimated 5 h, x3 for switching and rework"). Captured active time already bridges pauses under 5 min, so do not re-add a multiplier for within-run think time. Reasoning log: why each cluster is a process, a candidate, or excluded (one-offs + creative logged as considered-and-excluded). _Gate:_ frequency traces to counted cases or a stated inference; time carries n + spread, reasoned.

**Stage 3.5 — Common path (80/20).** Describe the single dominant way it usually goes (~80/90% sequence) + rough coverage. Do NOT over-model (no variant trees, loops, exception enumeration). Note exceptions exist but aren't modelled, and that **building the automation needs deeper hands-on analysis**. Common path = automatable core; remainder stays human. Path + coverage = **estimates**. _Gate:_ coverage + case-n recorded; output says it's an estimate needing deeper analysis to build.

**Checkpoint, confirm processes + pick what to detail (human review gate, triage menu).** Before the detailed half, STOP. First run a **light provisional pass** over EVERY qualifying process AND every demoted **candidate** (Stage 3), none dropped: rough automatable % (from category + work-nature, judgment cap applies), difficulty (Easy/Med/Hard), and uplift (provisional capacity-unlock % + net annual savings range), reusing the Stage 3 frequency + time and the cost basis. Everything here is **provisional**, refined by Stages 5, 5.5, 6 after selection. Then present **one table listing ALL of them**, confirmed processes first sorted by impact (annual hours) then occurrence (frequency), candidate-tier rows below:

| Pattern | What it is (1 sentence) | Occurrences (clean / possible) | Time/yr (h) | Est. automatable % | Difficulty | Uplift (capacity % + net $/yr) | Tier + confidence |

The last column marks each row **process** or **candidate (low confidence)** with a one-line reason for any candidate (e.g. "possibly monthly, window too short"). Under the table, list only the **true exclusions** and why (genuine one-offs, creative/judgment work); sub-threshold-but-recurring work appears IN the table as a candidate row, never demoted to a footnote. Then ask the user (`AskUserQuestion`, multi-select the rows) **which processes to dig deeper into**, and allow drop / merge / re-scope / redirect. Run Stages 4 to 6 ONLY on the selected processes; the rest stay in the table and in the ledger as logged-but-not-detailed (`selected_for_detail: false`), so nothing found is hidden. Honor their edits. If there are more candidates than the question can list, show the table and ask them to name their picks. If no human is available (batch run), record "checkpoint auto-passed" in `review.checkpoint`, dig into the top processes by provisional ROI, and continue.

**Stage 4: Decompose steps (activity level, map-ready).** Ordered steps: action (verb+object), app, input, output/artifact, time (reasoned), pain (reasoned), automatable (bool), note (what changes / watch-out). A row is not a step: derive steps from transitions across rows; don't split one row into separately-timed steps. Also capture for the map: **0 to 3 key decision points** with branches (estimated, light, not variant trees) and a **per-app per-run time** rollup (sum step time by app). Steps + decisions + per-app times = the map-ready representation; a downstream map skill reads this and draws the visual (like the /patterns Map view), not here. _Gate:_ each step maps to >=1 activity (cite IDs) or a labelled reasoned bridge; time/pain reasoned; decisions estimated; `app` is the resolved site/product name (never Chrome/Edge/the browser), per Stage 0.5's lookup rule.

**Stage 5: Map automation (decision tree).** **Order of consideration, apply top-down, never skip ahead, matching the Verdict + route tree below:** (1) still needed and worth changing? No -> kill or leave-as-is (document + train), stop there. (2) worth automating (net ROI + work nature)? No -> redesign (document + train), stop there. (3) automate: try the current stack/native features first (route a below), only reach for n8n (deterministic, rules-based) or Cowork (judgment/generation) if the current stack can't cover it. Classify into a category (Section 3). **Bottom-up fraction:** `automatable_fraction = sum(step.time where automatable) / sum(step.time)`, re-derivable; map the 1-5 score to a band (5 -> 0.8-0.95, 3 -> 0.4-0.6, 1 -> 0.05-0.2); express as a range; name human steps in `human_remainder`. **Judgment cap:** Content Generation + Research & Synthesis fraction <=0.6 unless OCR shows boilerplate.

**Verdict + route (walk every process through this tree, never forced):**

1. Still need it? No -> **kill**.
2. Worth changing? No -> **leave as-is** (document + train).
3. Worth automating (net ROI + work nature)? No -> **redesign** (document + train).
4. Automate -> **first route that fits**: (a) **current stack / native features**, incl. the company's own **custom/internal apps** (e.g. Notion's Jira sync, or extending an in-house tool) = least new tooling; (b) **Claude (chat or Cowork)** for judgment/generation/augment, preferring a verified connector that removes the manual action (connectors work in Claude chat and Cowork, so phrase it "connect [tool] to Claude", not "enable the Cowork connector"; for a non-technical owner, frame setup as done-for-them, not a DIY build); roll out + train on Skill creation (MemoryLane surfaces new Skills); (c) their **current automation tool**; (d) **n8n** (flexible, more upkeep) or **Gumloop** (less upkeep, not zero). Make/Zapier/Power Automate when the stack/team demands.
   - **Frame by effort/investment:** **quick wins (do now, low effort)** = Cowork, process redesign, current tooling / native connectors; **extra engagement (more build + investment)** = n8n / Gumloop / custom, offered as possible _if they want to invest_, never the lead. (The owner question informs upkeep risk; effort is the main lens.) Tag each as `effort_tier`.
   - Deterministic tools (n8n etc.) can't do judgment steps (story-pointing, picking findings), so for those they aren't full automation anyway, the judgment stays a human/AI-assist step whatever the tool.

**Connector capability check (before recommending a route):** for every API/MCP connector or plugin in the recommendation, fetch its latest official docs and confirm the specific read/write it needs; record server, read, write, how verified, and date in `connector_checks`. Confirm the **exact product/edition** the user runs (variants differ, e.g. Looker vs Looker Studio); if the surface tool cannot connect, pivot the route to the underlying data source and record that pivot in `connector_checks`. An unverified or write-incapable connector cannot back a Human-in-the-loop or Automated verdict (see Future state).

**Future state (score every kept process on this ordered scale):** **No change** (manual) -> **AI-augmented** (human operates, AI drafts/suggests) -> **Human-in-the-loop** (automation runs, human approves/handles exceptions) -> **Automated** (hands-off). Kills = **eliminated** (off-scale). Augmented vs HITL = who operates (human invoking AI = augmented; automation running with a human gate = HITL). Roughly MECE on one axis (how much the machine does); the tree picks the route, this labels the end state. Ordered, so a downstream report can render it as a chevron (highlight the step, grey the rest). **Capability ceiling:** the label follows _verified_ connector capability, not assumption. Reaching **Human-in-the-loop** or **Automated** (the machine writes) requires a **verified write** to the target tool; if only read is verified (or nothing), cap at **AI-augmented** (AI drafts, human writes). E.g. sprint estimation only moves from "AI drafts" to "runs with a human gate" once Jira + Notion writes are confirmed.

**Tie every recommendation to the manual step(s) it removes** (cite step numbers); prefer an integration that **eliminates** the action over one that merely assists (e.g. a Cowork Figma plugin that fills the slide template from a CSV/JSON, removing the copy/paste re-keying, not "paste into Claude then drop it in by hand").

**Name + frame honestly:** name the process after the **automatable slice + verdict**, not the creative whole; creative/judgment work is augment ("AI-assist: structure findings + draft deck text; designer keeps the insight and builds the deck"), never "automate the slide deck". A priority label must reflect net ROI + verdict, never the gross size of a judgment-capped activity. _Gate:_ tools exist in context or are explicit defaults; fraction re-derives; every process has a verdict, a route (if automate), a future-state label, the manual steps removed, and an honest name.

**Stage 5.5 — Automation feasibility.** Per candidate:

- **Work nature:** mechanical/repetitive -> automate; creative/high-judgment (Figma design, strategy, negotiation) -> augment or leave alone, never full automate.
- **Concrete mechanism (no hand-waving):** trigger -> tool/integration -> action -> what stays human, naming the manual step(s) removed. "Automate Figma" is not an answer; "auto-generate first-draft components from design tokens via a plugin, designer refines" is. No mechanism -> redesign or leave as-is.
- **Feasibility, two paths (API isn't the only gate):** (a) deterministic automation for recurring clearly-defined tasks where an API/webhook/integration is the **best** gate -> Automate; (b) **AI augmentation** for judgment/creative/variable work where a Cowork agent speeds it up with **no API** (drive UI, browse, code, draft, research, prototype, connect via Cowork plugins/MCP) -> AI-assist. Missing API shifts the path to AI-assist, doesn't kill it; mark feasibility low only when neither exists.
- **Automation cost (bands, estimated):** one-time build hours, tool $/mo, learning, maintenance.
  _Gate:_ every Automate/AI-assist has a mechanism + feasibility + work-nature tag; creative work never full automate.

**Stage 6 — Quantify savings + net ROI (ranges).** All arithmetic in code.

- Per process: `annual_hours = time_per_instance x frequency_per_year`; `automatable_hours = annual_hours x automatable_fraction`; `gross_$ = automatable_hours x rate`. Show inputs + labels.
- **Reconciliation invariant (displayed % == realized fraction).** The automatable % you publish MUST be the exact fraction that reproduces the reported (rounded, conservative) savings, i.e. `hours_freed = time_per_instance x frequency_per_year x automatable_fraction` and `annual_savings = hours_freed x loaded_rate`. Never display one automatable % while deriving the dollars from a different effective fraction. A skeptic multiplies the printed inputs and must land on the printed savings; per-process savings must sum to the role/function subtotal and then to the combined total. Carry the exact inputs so a downstream page reconciles without re-deriving (see `reconciliation` in §5). _Worked example (real build):_ slide-deck 3h/run x 2/month x 46% x A$105/hr -> ~A$3,500/yr; sprint-estimation 45m x 2/month x 28% x A$105/hr -> ~A$500/yr; Product subtotal A$4k. Marketing perf-reporting 27m daily x 90% -> ~A$6,200, SEM 35m x 8/month x 71% -> ~A$2,800, optimisation-logging 60m x 4/month x 60% -> ~A$2,000, all x A$70/hr; subtotal A$11k. Measured total A$15k; capacity 1h + 3h = 4h/week (5%); 2 + 3 = 5 processes.
- **Ranges** low/base/high on every figure; name the dominant uncertainty.
- **Annualization as a plain sentence** a non-expert can override: "Saw it [N] times in [window]; assume it runs [cadence]; so about [X]/year." Flag a yearly figure from a single observation as low-confidence. Carry the observed run-frequency through to the output and, by default, name recurrence (run-frequency) as the dominant uncertainty on annualized figures. In **sample mode** (low coverage), annual figures are still given but as estimates: sample-based, wide low/base/high range, coverage caveat, low-confidence; frame them as capacity unlocked + savings, basing the capacity % on observed work before projecting to the full role/team.
- **Net ROI (worth-it gate):** `net_annual = gross_annual - annual_automation_cost`; `payback_months = build_cost / monthly_net`. If payback > ~6 to 12 months, tool cost > savings, or high effort for a tiny saving, the verdict is **leave as-is** or **redesign**, not automate. Net, not gross, drives the verdict + ranking.
- **Shared cost; company view later.** One tool covering several processes: split its cost across them, never charge the full sub to each. Per-process ROI is local/single-user; the company portfolio view (total spend vs savings, sequencing) is a downstream rollup. Flag, don't fake.
- **Weakest-link labels** (estimated input -> estimated result).
- **No double counting:** `activity_id -> process` map; each activity in one process.
- **Reconcile with the built-in detector:** if `list_patterns` exists, cross-check frequency vs its per-pattern stats (`seen Nx`, `~N/wk over M observed days`) and time vs `avg N min/run` (measured from activities, sampling-immune); cite as support, never add to your numbers; report discrepancies. The miner backfills ~60 days, but stats cover the recent window shown in the output, so absent != nonexistent.
- **Roll up + frame as capacity unlocked + savings.** `capacity_unlocked_pct = annual saved hours / annual work capacity` (this person; or the team if headcount supplied); pair with net $ saved. Headline reads like "automating these unlocks ~12% of annual capacity (~$Xk), low/base/high". FTE = saved hours / working hours per year. Per role/department (this person's share) then an n=1 exec total.
- **Per-function loaded rate (carry the derivation verbatim).** `cost_basis.derivation` states base salary, loading multiplier, work-year hours, and the resulting loaded rate, in this exact shape: Product "A$160k base -> A$105/hr loaded (x1.3 on-cost over ~1,950 h)", Marketing "A$105k base -> A$70/hr loaded (same basis)". When several ledgers combine downstream, **each role/function keeps its own loaded rate**; per-process savings sum to that function's subtotal, function subtotals sum to the combined total, and the exec headline restates the combined total. Never blend two functions onto one rate.
  _Gate (triple-test):_ re-derive top-3 savings independently; dedup map has no duplicate IDs; aggregate = sum of parts and sits under `total_active_hours`; FTE checked; inputs labelled; ranges present.

**Stage 7 — Systems landscape.** Synthesis, last because it needs automation status. Inventory + time share come from the cleaned baseline (0.5); this stage overlays function grouping (Source/ERP, Comms, Docs, BI, Finance, CRM) + status (manual/partial/automated) from how each system appears in processes. _Gate:_ every system appears in the cleaned baseline list.

**Final Review — adversarial.** Mechanical checks as code (aggregate = sum of parts; no duplicate IDs; % per app ~100; every headline has a range + label). Then break it: any number without label/evidence/range? sampled count? weak reasoning log? duplicate ID? team/FTE without headcount? `automatable=true` on judgment the data can't show is mechanical? tool not in context? aggregate above ceiling? click-level/fabricated detail? overall future-state label inconsistent with its steps (an AI-augmented or human-in-the-loop process with no human/judgment step, or an all-automate step list under an augmented label)? **Slop sweep:** every name/app/tool/step/number traces to a row or labelled assumption, else strip; deterministic numbers re-run identically. **Threshold-sensitivity:** re-segment one day at 3-min and 10-min gaps; if process count or total time shifts >25%, flag it. Write `what_would_sharpen` (2 to 4 cheap next steps that most raise confidence). Only survivors ship; record verdict + demoted/stripped.

**Privacy scrub (mandatory, before ship).** A stated ban on identifiers is not enough; verify it: (a) **code-run a regex scan** of the full `process-analysis.md` for:

- emails `[\w.+-]+@[\w-]+\.\w`, phone numbers, `@handles`;
- credential/token params (`(token|key|secret|sig|signature|auth|session|sid|apikey|api_key|password)=[A-Za-z0-9%._~+/-]{16,}`), a JWT `eyJ[A-Za-z0-9_-]{10,}\.eyJ`, an AWS key `AKIA[0-9A-Z]{16}`, an API secret `sk-[A-Za-z0-9]{20,}`/`ghp_[A-Za-z0-9]{36}`/`xox[bp]-`, or an `X-Amz-Signature` param;
- card/bank numbers: 13-16 contiguous digits **gated by a Luhn check** (do not flag every long digit run, that catches invoice/order IDs you must keep) plus IBAN `[A-Z]{2}\d{2}[A-Z0-9]{11,30}`;
- dashed US SSN `\d{3}-\d{2}-\d{4}` (bare 9-digit runs collide with kept IDs, skip those).
- **market-specific national IDs** (this pipeline runs in the Philippines, Malaysia, Czech Republic, Slovakia, German-speaking markets, Australia, and New Zealand, not just the US: a US-only regex misses all of these): Philippines SSS `\d{2}-\d{7}-\d`, TIN `\d{3}-\d{3}-\d{3}(-\d{3})?`, PhilHealth `\d{2}-\d{9}-\d`; Malaysia NRIC/MyKad `\d{6}-\d{2}-\d{4}`; Czech Republic + Slovakia rodné číslo `\d{6}/\d{3,4}`; Germany Steuer-ID `\d{2} ?\d{3} ?\d{3} ?\d{3}` or Sozialversicherungsnummer `\d{8}[A-Z]\d{3}`; Austria Sozialversicherungsnummer `\d{4} ?\d{6}`; Switzerland AHV/AVS `756\.\d{4}\.\d{4}\.\d{2}`; Australia TFN `\d{3} ?\d{3} ?\d{3}` or Medicare `\d{4} ?\d{5} ?\d`; New Zealand IRD `\d{2,3}-?\d{3}-?\d{3}`. Same rule as the US SSN: any of these is high-severity, strip on match, but a plain digit run without the market's separator pattern is more likely a kept invoice/order/case ID, don't strip on digits alone.
  Any hit -> redact to a role/generic label (or, for a credential param, drop just that param and keep the URL path) and fix the source field.
  (b) **Re-read these high-risk free-text fields** specifically against Principle 9's strip-list (person names, emails, phones, handles, customer contact names, home addresses, card/ID/DOB values, health/medical content), they carry window-title/OCR text furthest from the numeric pipeline: `steps[].input/output/note`, `what_varies`/`what_constant`, `reasoning_log[].why`, `assumptions[].plain`, `common_path.description`, `cowork_skills[]` (all text), `data_coverage_notes`, `blind_spots`, `tier_note`, `narrative_summary`. Also scan for keyword triggers ("DOB", "Date of Birth", "Passport No", "SSN", "diagnosis", "MRN", "patient") that flag content needing generic paraphrase even without a clean regex hit. **Do not strip Principle 9's keep-list** (file/sheet/tab names, filter/view names, URL paths, formulas, folder paths) out of these same fields: that detail is what makes `steps[].input/output` and the automation `mechanism` reproducible; scrub people (and the PII/PHI classes above) out, leave the artifacts in. A keyword-trigger false-positive on a kept column header is the correct failure direction; when unsure, route to review rather than silently stripping or silently keeping. (c) Record `review.privacy_scrub: "passed"` (or the fields fixed) in the schema. Regex alone misses bare names; the field re-read is what catches those.

## 3. Process Categories

RPA-era (deterministic): **Data Shuttle** (move structured data between apps), **Reporting Ritual** (same sequence on a schedule), **Review Pipeline** (queue -> cross-reference -> decide), **Data Entry** (read source -> type into forms), **Alert Response** (notification -> act -> return).
AI-era (LLMs automate what RPA discarded): **Content Generation** (draft docs/emails/decks from inputs) and **Research & Synthesis** (gather across sources -> brief), both fraction <=0.6 unless templated. Use exactly these seven; if none fit, it's likely not an automation candidate (log why).

## 4. Scoring, confidence, coverage

- **Impact** = annual hours (range). **Automatability (1-5)** = how much AI/automation removes (per the Stage 5 band). **Effort** = Easy/Med/Hard. **Priority** = rank by `Impact x Automatability`, Effort as tie-breaker; surface quick wins (high automatability + Easy) and big bets (high impact + Hard).
- **Confidence grade (deterministic, per process + overall).** Four signals: case-n (>=5 strong / 3-4 medium / <3 weak); **sessionization basis, graded by the ID-corroborated share K/N** (>=70% strong, 30 to 70% medium, <30% weak; strong content/topic continuity can lift a low-ID share off the gap-only floor by one step, never to strong); data completeness (full unsampled strong, any sampled day weak); cadence coverage (window contains cadence strong, single-observation weak). >=2 weak = **Low**; all strong = **High**; else **Medium**. **Candidate-tier processes (Stage 3 demotions) are Low by construction.** Overall = lower of (baseline completeness, median process grade), computed over confirmed processes only so a pile of low-confidence candidates does not drag the headline down. State the reason for any Low. **Sample mode (coverage < ~40%) caps overall confidence at Low** regardless of other signals.
- **Coverage:** rank and TABLE every qualifying process at the Checkpoint menu (none dropped); fully detail the ones the user selects to dig into (or the top ~5 to 7 by ROI if the checkpoint auto-passed), and keep the rest as tabled triage rows in the ledger. The "top-3 re-derivation" is a verification depth check, not an analysis cap. Targets chosen by net ROI + verdict; a high-impact leave-as-is/redesign process is shown and explained, never forced into automation.

## 5. Output: the Analysis Ledger

Write **one file**, `process-analysis.md`, then a 5-line chat summary (don't dump raw output). **No separate JSON file.** Put the readable narrative first, then embed the full structured ledger as a single fenced ` ```json ` code block at the end of the same file (schema below) so the file is both the human-readable report and the machine-readable ledger. This filename + the embedded block is the hand-off contract the packaging (`report-new`) skill reads; keep both.

```json
{
  "meta": {
    "user_role": "",
    "department": "",
    "location": "",
    "measurement_scope": "single observed user (n=1)",
    "observed_user_count": 1,
    "data_source": "",
    "data_quality_tier": "",
    "window": "",
    "activities_analyzed": 0,
    "active_days": 0,
    "work_hours_per_day": 8,
    "capture_coverage_pct": 0,
    "sample_mode": false,
    "cost_basis": { "hourly_rate": 0, "currency": "", "basis": "estimated", "derivation": "" },
    "data_coverage_notes": "",
    "blind_spots": "",
    "threshold_sensitive": false
  },
  "baseline": {
    "total_active_hours": { "value": 0, "basis": "reasoned" },
    "active_days": { "value": 0, "basis": "seen" },
    "app_time_share": [{ "app": "", "pct": 0, "hours": 0, "basis": "reasoned" }],
    "deep_work_share": { "value": 0, "basis": "reasoned" }
  },
  "exec_rollup": {
    "total_repetitive_hours_per_week": {
      "low": 0,
      "base": 0,
      "high": 0,
      "basis": "reasoned",
      "evidence": []
    },
    "automatable_pct": { "low": 0, "base": 0, "high": 0, "basis": "estimated" },
    "capacity_unlocked_pct": { "low": 0, "base": 0, "high": 0, "basis": "estimated" },
    "hours_saved_per_year": {
      "low": 0,
      "base": 0,
      "high": 0,
      "basis": "estimated",
      "error_sources": []
    },
    "dollars_saved_per_year_net": { "low": 0, "base": 0, "high": 0, "basis": "estimated" },
    "fte_capacity_unlocked_this_person": { "low": 0, "base": 0, "high": 0, "basis": "estimated" },
    "team_extrapolation": {
      "headcount_supplied": false,
      "value": null,
      "basis": "estimated",
      "multiplier": "",
      "unverified": true
    },
    "overall_confidence": { "grade": "", "why": "" },
    "headline": "e.g. Automating these unlocks ~12% of annual capacity (~$Xk/yr), low/base/high",
    "shown_caveat": ""
  },
  "processes": [
    {
      "name": "",
      "category": "",
      "role_department": "",
      "selected_for_detail": true,
      "tier": "process",
      "tier_note": "process | candidate (low confidence, sub-threshold but recurring); reason if candidate",
      "frequency": {
        "occurrences_clean": 0,
        "occurrences_possible": 0,
        "period": "",
        "basis": "reasoned",
        "evidence": [],
        "annualization_multiplier": "",
        "id_corroborated_runs": "K of N"
      },
      "time_per_instance_min": {
        "n": 0,
        "median": 0,
        "iqr": "",
        "basis": "reasoned",
        "evidence": []
      },
      "annual_hours": { "low": 0, "base": 0, "high": 0, "basis": "estimated" },
      "common_path": {
        "description": "",
        "approx_coverage_pct": 0,
        "basis": "estimated",
        "note": ""
      },
      "steps": [
        {
          "action": "",
          "app": "",
          "input": "",
          "output": "",
          "time_min": 0,
          "pain": "",
          "automatable": true,
          "note": "",
          "basis": "reasoned",
          "evidence": []
        }
      ],
      "decision_points": [{ "question": "", "branches": [], "basis": "estimated" }],
      "time_per_app_per_run": [{ "app": "", "minutes": 0 }],
      "reconciliation": {
        "per_run_min": 0,
        "frequency_per_year": 0,
        "automatable_pct": 0,
        "loaded_rate": 0,
        "hours_freed": 0,
        "annual_savings": 0,
        "note": "per_run_min x (frequency_per_year/60... ) -> the displayed automatable_pct reproduces annual_savings; downstream reads these, never re-derives"
      },
      "what_varies": "",
      "what_constant": "",
      "automation": {
        "verdict": "kill|leave_as_is|redesign|automate",
        "future_state": "no_change|ai_augmented|human_in_the_loop|automated|eliminated",
        "route": "current_stack|internal_app|claude_cowork|current_automation_tool|n8n|gumloop|other",
        "effort_tier": "quick_win|extra_engagement",
        "work_nature": "mechanical|creative_judgment",
        "mechanism": "",
        "removes_manual_steps": [],
        "feasibility": "api|webhook|agent|none",
        "tool": "",
        "approach": "",
        "automatable_fraction_low": 0.0,
        "automatable_fraction_high": 0.0,
        "human_remainder": "",
        "automation_cost": {
          "build_hours": "",
          "tool_monthly": 0,
          "learning": "low|med|high",
          "maintenance": "low|med|high"
        },
        "basis": "estimated"
      },
      "scores": { "impact_hours": 0, "automatability": 0, "effort": "", "priority_rank": 0 },
      "confidence": { "grade": "", "drivers": "" },
      "savings": {
        "annual_hours_saved": { "low": 0, "base": 0, "high": 0 },
        "gross_annual_dollars_saved": { "low": 0, "base": 0, "high": 0 },
        "net_annual_dollars_saved": { "low": 0, "base": 0, "high": 0 },
        "payback_months": 0,
        "formula": "",
        "inputs": [],
        "dominant_uncertainty": ""
      }
    }
  ],
  "systems_landscape": [
    {
      "system": "",
      "function_group": "",
      "time_share": "",
      "roles": [],
      "automation_status": "",
      "basis": "reasoned"
    }
  ],
  "patterns_cross_check": [
    { "pattern": "", "their_frequency": "", "our_frequency": "", "discrepancy_note": "" }
  ],
  "reasoning_log": [
    {
      "candidate": "",
      "verdict": "process|not_a_process|candidate",
      "why": "",
      "common_path_coverage_pct": 0,
      "case_n": 0,
      "evidence": []
    }
  ],
  "assumptions": [
    {
      "plain": "",
      "process": "",
      "observed_count": "",
      "window": "",
      "assumed_cadence": "",
      "annual_estimate": ""
    }
  ],
  "connector_checks": [
    { "server": "", "read": false, "write": false, "verified_via": "", "date": "" }
  ],
  "cowork_skills": [
    {
      "process": "",
      "name": "",
      "benefit_line": "",
      "trigger": "",
      "steps": { "connect": "", "create": "", "run": "" },
      "notes": "",
      "connectors": [],
      "human_approval_gate": ""
    }
  ],
  "bottom_line": {
    "automatable_task_count": 0,
    "hours_saved_per_year": { "low": 0, "base": 0, "high": 0 },
    "dollars_saved_per_year_net": { "low": 0, "base": 0, "high": 0 },
    "capacity_unlocked_pct_per_person": 0,
    "capacity_unlocked_pct_per_role": 0,
    "how": ""
  },
  "what_would_sharpen": [],
  "narrative_summary": "",
  "review": {
    "verdict": "",
    "checkpoint": "approved|adjusted|auto-passed",
    "demoted": [],
    "stripped": [],
    "privacy_scrub": "passed",
    "double_count_check": "passed",
    "threshold_sensitivity": "",
    "reproducibility_note": "deterministic numbers reproduce exactly; AI-judgment calls may vary slightly"
  }
}
```

The narrative portion of `process-analysis.md` (everything before the trailing embedded json block, per §5) reads as: coverage header (with the n=1 line), baseline, exec roll-up (ranges + plain-word labels + `shown_caveat`), then the **full Checkpoint triage table** (every qualifying process AND every candidate-tier row, confirmed processes first sorted by impact then occurrence, candidates below: name, one-sentence what-it-is, annual hours, provisional automatable %, difficulty, uplift, tier + confidence) so nothing found is hidden, a detailed section per **selected** process (common-path summary, steps table, automation, savings ranges + formula + dominant uncertainty) with tabled-only ones left as triage rows, systems landscape, patterns cross-check, confidence per process + overall, a short "what would sharpen this" list, then reasoning log + assumptions. Then a **Bottom line** block: count of automatable tasks, time + net $ saved/yr, efficiency unlock per person and per role, and one or two plain sentences on how it's done (mirrors `bottom_line`). End with a **Storytelling summary**: under 100 words, plain English, grounded only in the ledger numbers + caveats, covering what we found, what to do, the benefit, and why (mirrors `narrative_summary`). **Exec roll-up aggregated + scoped n=1; processes per role/department; no personal names anywhere in the document.** Immediately after this narrative, append the fenced ```json ledger block (schema in §5) as the file's final section.

**Cowork skills (deliverable):** for each automatable process, emit a ready-to-run skill spec in `cowork_skills` (name, `benefit_line`, trigger, steps, notes, connectors, a human-approval gate), mirroring the MemoryLane Skill tab. Write the steps in a non-technical 3-step mold a non-technical owner understands: **Connect** (which apps to connect to Claude), **Create** (the skill that drafts the output), **Run** (the cadence, that they click to run it, and that a human reviews and approves before anything is written). Lead each with one plain `benefit_line` in the form "Use AI to [draft X] for human review instead of [manual grind]". Keep it jargon-free, frame skill setup as done-for-them, and never require the reader to know how to build a skill. Optionally write a standalone `SKILL.md` for the top one to the working dir.

**Map-ready:** each process's `steps` + `decision_points` + `time_per_app_per_run` are everything a downstream map skill needs to draw a node-per-step map; this skill emits the data, rendering is downstream and self-contained.

**Hand-off contract:** every exec-bound number carries its basis label + a one-line `shown_caveat`; the packaging skill must display both adjacent to each headline and reproduce the reasoning-log verdict count. Each process also carries the `reconciliation` block (per-run time, frequency/yr, displayed automatable %, loaded rate, hours freed, annual savings) so the report reconciles every figure across pages by reading, never re-deriving; the displayed automatable % is the realized fraction (per Stage 6). (A contract, not enforceable on a sibling renderer; Final Review asserts the data carries it.) Emit one source value per metric at a consistent rounded grain, and ensure per-process figures sum to their role/department subtotal and the exec total, so the report reconciles without hand-edits.

**⛔ Stop at the ledger. Do NOT package.** Your deliverable ENDS at
`process-analysis.md` (with the embedded json block) + the 5-line chat summary
(+ optional `cowork_skills` specs). Do not render HTML, do not create a PDF, do
not invoke or hand straight into the `report-new`/packaging skill. Packaging is
a separate, **user-initiated** step, and that skill shows the HTML deck for
review before any PDF exists. After writing the file, give the short summary
and stop; if the user wants the visual deck, they start packaging next. Never
chain analysis → PDF in one run.

## 6. Guardrails

- Too thin (<5 activities after extending the window): say so and stop; don't invent. The baseline still delivers value.
- Low capture coverage (sample mode): report the captured slice honestly and label it as a sample; the capacity/savings headline is still shown but as a coverage-caveated estimate with a wide range, never as a precise full-role fact.
- Reserve `get_activity_details` (OCR) for high-value confirmations (case IDs, true durations on 2 to 3 sample instances per top process, automation specifics). Keep it bounded.
- Never present estimated as seen/reasoned; when unsure, pick the weaker label; never a bare point value for a headline.
- Extrapolation is expected: reasonable, traceable, labelled, and ranged.
- **No auto-packaging.** Finish at the ledger files + chat summary. Never render HTML or a PDF, never chain into the `report-new` skill; the user starts packaging, and HTML review precedes any PDF (see "Stop at the ledger" in §5).
