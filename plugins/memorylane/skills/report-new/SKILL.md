---
name: report-new
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, AskUserQuestion
description: >
  (new) Turn a process analysis into a polished, client-ready report, first an HTML
  deck you review, then a matching PDF. Use to package an analysis into an exec report
  or PDF. Shows the deck for approval before making the PDF, and never makes up numbers.
---

# Report Packaging (Visual Deliverable)

Turns a **process-mining ledger** (where time goes, repeated processes,
automation, savings, all basis-labelled) into the **deliverable an exec says
"YES" to**: a clean, visual, defensible **HTML + PDF**. The ledger is the input;
this skill renders and persuades. Runs **independently** of any analysis skill:
if input is missing, it asks.

Two hard requirements:

1. **Beautiful, concise, grounded.** Beat a top consulting deck on design,
   clarity and brevity (`assets/components.html`). Less prose, more structure.
   Recommendations are **hyper-specific to this customer**: their actual tools,
   the concrete mechanism, the human remainder. Never invent a number, app, tool
   or step not in the ledger.
2. **PDF == HTML.** Exact reproduction: clean page breaks, nothing clipped or
   split. By design (fixed-size pages + one inlined stylesheet) + a verify step.

**Never fabricate. Always nudge.** Any missing key input (a ledger, a bound
field, a role/department label, client name, logo, cost rate) → STOP and ask in
one batched question. Never invent identity, numbers, roles, tools, or steps to
fill a gap or smooth a layout. This overrides speed and overrides every default
below.

**HTML first. PDF only after the user approves (mandatory stop).** The user
ALWAYS reviews the HTML deck before any PDF exists. Render `report.html`, show
it, then STOP and wait for explicit approval ("yes" / "approved" / "ship it").
Never generate the HTML and the PDF in the same turn; never jump to a PDF or a
`*-final.*` file unprompted. The ONLY PDF allowed before approval is the
throwaway `/tmp` overflow probe in stage 5 (internal QA, never presented as the
deliverable). If you have not received approval in this conversation, end your
turn after the review step (stage 6). This overrides speed.

---

## 1. Inputs (1 or many users)

Source: one or more `process-analysis*.json` ledgers in the working dir (+
optional `.md` for wording). Each ledger is **one observed person** (the analysis
is single-user by construction). Any producer of the same shape works.
- **Detect the cohort:** glob `process-analysis*.json` (and any paths the user
  gives). 1 file → single-user report. 2+ → **consolidated** report (§7 stage 2).
- Each ledger MUST carry `meta.role` (and ideally `department`) for grouping. If
  a ledger lacks a role label, **ask** which role/department it belongs to;
  never guess.

**Expected ledger shape** (top-level keys + the leaves the report binds; omit
any element whose field is absent, per §2):
- `meta`: role, location, window, active_days, measurement_scope, `cost_basis`
  (rate, derivation, basis), shown_caveat; optional report_title, client.
- `exec_rollup`: repetitive_hours_per_week, automatable_pct, hours_saved_per_year,
  dollars_saved_per_year, fte_capacity, overall_confidence{grade,why}, shown_caveat.
  Headline figures = `{low,base,high,basis}`.
- `baseline`: total_active_hours, active_days, `app_time_share[]`{app,pct,hours},
  deep_work_share.
- `processes[]`: name, category, role_department, frequency, time_per_instance,
  common_path{description,approx_coverage_pct}, `steps[]`{action,app,input,output,
  time_min,pain,automatable,basis}, `automation`{verdict,work_nature,mechanism,
  feasibility,tool,automatable_fraction,human_remainder,automation_cost},
  `scores`{impact_hours,automatability,effort,priority_rank}, confidence{grade},
  `savings`{annual_hours_saved,gross/net dollars,payback_months,dominant_uncertainty}.
- `systems_landscape[]`, `reasoning_log[]`(+counts), `assumptions[]`,
  `what_would_sharpen[]`, `narrative_summary`, `review`{reproducibility_note}.

`assets/components.html` shows the exact field→page binding on sample data.

**Intake gate.** Ask ONCE in a single batched `AskUserQuestion` for everything
missing. Cosmetic fields take a default on skip; **data-affecting gaps are never
invented** (per the rule above): label them missing/estimated or omit:
- **Ledger(s)** path/data, and which users form the cohort (if absent or a
  different shape: ask for the file(s) or the fields above).
- **Role/department** for any ledger missing it (grouping key, never guessed).
- **Cost rate** if absent from a ledger (else mark estimated, show derivation).
- **Report title** (default "<role/team> Automation Map"); **client/company
  name**; **confidentiality line** (default "COMMERCIAL IN CONFIDENCE").
- **Client logo** (file path or URL). See §4 — **always nudge if not given**.
- **Branding** (MemoryLane default / neutral) and **orientation** (landscape
  default / portrait).

---

## 2. Honesty contract (non-negotiable)

The ledger labels every exec number `seen` / `reasoned` / `estimated` with a
`shown_caveat` and a reasoning log. Surface them, or this becomes slop:
- **Every headline number carries its basis** as a chip (`seen` green ·
  `reasoned` blue · `estimated` amber) or the inline `.basis` micro-label. No
  bare numbers.
- **`shown_caveat` near the headlines** (cover note + exec summary).
- **Scope line in every footer** stating the observed population: "Based on 1
  observed person (n=1)" or "Based on N observed people across M roles". Cohort
  totals (summed across the observed people) are real for those people;
  extrapolation beyond the observed headcount is estimated/unverified.
- **Reproduce the reasoning-log verdict count** in the appendix header.
- **Ranges (low–base–high)**, never false precision.
- **Reconcile across pages.** Every per-process figure rolls up to its function
  subtotal and to the exec headline; a number shown on more than one page matches
  everywhere. Change one figure → re-derive the rollup. Never hand-edit a headline
  or a summary cell in the HTML without re-deriving it from the ledger. The chain
  a reader can reproduce from the inputs printed on any page: per-run time x
  frequency x automatable% = hours freed; hours freed x the role's loaded rate =
  annual savings; per-process savings sum to the function subtotal; function
  subtotals sum to the combined total; the headline restates the combined total.
  *Worked example (shipped):* Product (slide deck ~A$3,500 + sprint ~A$500) = A$4k;
  Marketing (~A$6,200 + ~A$2,800 + ~A$2,000) = A$11k; Measured (2 users) = A$15k;
  capacity 1h + 3h = 4h/week (5%); 2 + 3 = 5 processes.
- **One rounding grain.** Round money to a clean grain with "~" (nearest $100/$1k
  by confidence) and use the SAME grain on every page; no to-the-dollar figures
  from a thin sample.
- **Measured first, extrapolation labelled.** Lead with the measured figure
  ("Measured (N users)"); show any company-wide/extrapolated number as a separate,
  clearly labelled illustrative/directional row (lower-range, net of licence and
  rollout costs). Never headline the extrapolated number as fact.
- **Commercials stay out of the body.** No price, retainer, or minimum-term in the
  report; at most a neutral "bundled monthly fee". Pricing lives in the quote.
- **Render only what the ledger contains.** Missing field → omit the element.
  Anti-slop is the product.

**Number + money formatting (house style, from shipped reports; currency follows
the ledger, A$ shown as the example).**
- Capacity + time reads `1h/week (2%)` (no space inside `1h`, one space before the
  parenthesis). Shipped: `1h/week (2%)`, `3h/week (8%)`, `4h/week (5%)`, `~1 FTE (5%)`.
- Per-process figures and the in-scope table carry `~` and full digits with a comma
  (`~A$6,200`, `~A$3,500`, `~A$500`, total `~A$15,000`); exec KPI tiles and the
  measured/total rows are the rounded grain with NO `~` (`A$4k`, `A$11k`, `A$15k`,
  `A$100k+`); the headline reads `save A$100k` (no `~`, no `+`). `~` is used ONLY on
  per-process dollars, the in-scope total, and the illustrative figures (`~A$100k+`,
  `~1 FTE`, `~15%` of a workday), never on exec/measured rows or the headline.
- Freed capacity is always phrased "New capacity unlocked" (KPI tile label AND the
  per-function table column header, identical wording).
- Each per-process tile shows three cells: [avg time per run, frequency] /
  [Automatable %] / [Est. annual savings]. The metric cell is the Automatable %,
  never hours/yr (a percentage is easier to picture).

**Data-confidence banner (read the thinness, say it).** Compute a tier from the
ledger's coverage (total active hours, active days, #people, window) and show it
as a one-line `.databanner` near the headlines (cover + exec); fold it into the
scope line too. Tiers and voice:
- **rich** (≈20+ active days, or n≥3 in a role): "Strong sample, numbers are
  well-grounded."
- **ok** (a couple of weeks, decent hours): "Solid first read (N days, n people)."
- **light** (few days / one person): "Directional first read, not a verdict;
  ranges wide on purpose."
- **thin** (e.g. ~7h over 8 days, n=1): say it plainly and stay useful, e.g.
  *"~7h over 8 days, 1 person. Little data, but here's the read: <top finding>.
  Reasonable extrapolation: <X>. Act on the top one; get more data before the
  rest."* Friendly, confident, actionable, never a disclaimer dump.
Thin data also: widen the ranges, push figures to `estimated`, and lead with the
single most reasonable extrapolation + the one action, not a hedge.

**Voice, no essays.** Short, plain, compelling. Fragments and bullets over
paragraphs; label, number, basis, done. The only running prose is the ledger's
`narrative_summary` (<100 words) and the conclusion. State data thinness in ONE
line (the banner), never a wall of caveats. Friendly and direct: "little data,
here's the read, here's the reasonable extrapolation, here's the one move."

---

## 3. Design system & assets

In `assets/` beside this file:
- **`report.css`** — full design system + print rules. **Inline it into a
  `<style>` tag.** The whole report is **one self-contained HTML file**: CSS
  inlined, charts as inline SVG/CSS, images as data URIs, **no external links,
  no CDN, no JS**. This is what makes the PDF portable and faithful.
- **`components.html`** — rendered reference gallery of every section archetype
  on sample data. **Clone these blocks, bind real values, match the look.**
- **`render-pdf.mjs`** + **`make-pdf.sh`** — the PDF pipeline (§7–8).

Brand tokens live in the CSS (do not re-pick): `--accent` warm amber, `--panel`
deep ink-navy (cover + bands), Inter sans / Geist mono, near-white body.

**App/tool logos.** Every app named in a process renders its real logo from a
maintained icon map (data-URI'd, never linked); for a tool with no logo file,
inline a small SVG glyph. Never show a generic globe placeholder in the final
deck, and flag any missing icon at verify rather than substituting one.

**Tables.** Span the full page width with balanced colgroups. Right-align numeric
and money columns to the column edge; center small metric columns; never leave
left-hugging gaps in wide columns.

---

## 4. Client logo & company name

The report carries the client's identity, like a consulting deliverable.

- **Get it:** from the intake answer. **If no logo was given, nudge once**
  ("Send the logo file or a link and I'll place it on the cover + every page;
  otherwise I'll use the company name as a text wordmark.") Proceed either way.
- **Embed, never link** (PDF portability): a **URL** → download via
  `curl -L -o /tmp/logo.<ext> "<url>"`; then encode to a data URI
  (`base64 -i /tmp/logo.png` → `data:image/png;base64,…`). SVG can be inlined or
  data-URI'd. Use `<img src="data:…">` so it survives into the PDF.
- **Cover (page 1):** the `.cover__client` lockup ("Prepared for" + logo),
  logo `max-height:44px`, aspect preserved.
- **Every page footer:** `<img class="foot-logo">` (`height:14px`) + the company
  name in the footer text. The CSS caps both dimensions; keep aspect ratio for
  wide and square logos alike.
- **Contrast:** the cover logo sits on a white plate (CSS) so dark logos read on
  the dark cover; add `.plain` if the logo is already light. The footer is light,
  so a light/white logo there needs a dark plate, add one.
- **No logo:** show the company name as the wordmark (cover + footer); still
  nudge.

**Per-app icons (time-by-application appendix), and the acquisition gotchas we
hit shipping:**
- Inline every icon as a data URI: PNG → `data:image/png;base64,…`, brand SVG →
  `data:image/svg+xml;base64,…`. Size each at
  `width:20px;height:20px;border-radius:4px;object-fit:contain`.
- A site's `favicon.ico` is sometimes actually a PNG (one client's was a 231×231
  PNG named `.ico`). Detect with `file`, convert/rename with `sips` before use.
- Never use a sprite sheet as a single logo (a 456×76 multi-logo strip is not one
  icon); fetch the individual brand SVG instead.
- `cdn.simpleicons.org` can return 0 bytes; fall back to jsdelivr
  (`cdn.jsdelivr.net/npm/simple-icons@<v>/icons/<name>.svg`).
- Monochrome brand SVGs need the brand hex injected as `fill` before inlining
  (e.g. Slack `#4A154B`, OpenAI/ChatGPT `#10A37F`).
- The long-tail "Other" row uses a neutral inline 3-dot glyph (`#9B9690`), never
  a brand logo.

---

## 5. Page model — why breaks stay clean

The report is a stack of `.page` elements; each is **exactly one A4-landscape
sheet** (fixed size in `report.css`). Print maps **one `.page` → one PDF page**
via `break-after: page`. Pages are **composed to fit**, not reflowed, so breaks
are deterministic and nothing splits mid-element.
- Compose each page to fit; if a section overflows (long step table, many
  processes), **split across more `.page` blocks**.
- The CSS already sets `break-inside: avoid` on cards/tables/rows and
  `print-color-adjust: exact` (backgrounds/chips/gradients print).
- The verify step (§7) flags any overflowing page; fix before approval.
- Portrait: switch `@page` + `--page-w/--page-h` (noted in the CSS).

---

## 6. Section map (ledger → pages)

Cover first, appendix/conclusion last; reorder the middle for narrative.

| Page | Source | Archetype |
|------|--------|-----------|
| **Cover** | `meta`, `exec_rollup` (4 KPIs + caveat), client logo/name | `.cover` |
| **Exec summary** | `exec_rollup`, top `processes`, `narrative_summary`, confidence | KPI row + `.card-grid` |
| **Baseline** | `baseline` (app bars, active days, hours, deep-work) | `.bars`, KPI, range |
| **Process scoring** | `processes[].scores`, category, frequency, confidence, verdict | `.tbl` + `.dots` + chips |
| **Automation matrix** | `processes[].scores` (impact × automatability) | `.matrix` + `.bub` |
| **Process detail** (top ~5–7 by rank) | `processes[]`: common_path, steps, automation, savings | step table + savings card |
| **Long-tail table** | lower-ranked `processes[]` | `.tbl` (light) |
| **Systems landscape** | `systems_landscape[]` | `.sys-grid` + status chips |
| **Opportunities** | top processes by net ROI | `.opp` cards |
| **Appendix** | `reasoning_log`(+counts), `assumptions`, `what_would_sharpen`, cost derivation, reproducibility_note | `.logrow`, `.assume`, cards |
| **Conclusion** | `narrative_summary` + headline tallies | `.story` + `.statlist` |

Chips: basis `seen|reasoned|estimated`→`chip--seen|--reason|--est`; confidence
`high|medium|low`→`chip--hi|--med|--lo`; verdict `automate|ai_assist|redesign|
not_worth_it`→`chip--auto|--assist|--redesign|--no`; category→`chip--cat`;
system status→`chip--status`.

**Per-process framing (the actionable core):** Symptom → Time → Solution.
Solution must be concrete and customer-specific: trigger → their named tool →
action → what stays human, plus 2–4 actionable bullets. No generic "automate X".
Detail the strongest ~5–7 fully; list the rest in the long-tail table. A "Not
worth it" process is shown and explained, never forced into an automation.

**Label consistency:** every step chip and the future-state scale match the
appendix legend's definitions, and each process's overall recommendation is
consistent with its steps (an AI-augmented or human-in-the-loop process keeps at
least one human/judgment step; flag an all-automate step list under an augmented
label). **Show recurrence:** carry each process's observed run-frequency into its
detail tile and any opportunities table, and treat recurrence as the largest single
uncertainty.

Conclusion = `narrative_summary` plus a punchy stat-list (processes found / worth
automating now / repetitive hours / $ recoverable / scope).

**Multi-user (cohort) layout.** With 2+ ledgers, the exec rollup is AGGREGATED
across the population; processes are reported per role/department (founder's
rule: numbers aggregate, workflows split by role). Add:
- **Population & roles** page (after exec summary): one row per role/department,
  with users observed, days, repetitive hrs/wk, top tools. Anonymized to
  roles/teams, **never personal names**.
- **Per-role rollup** table: role → users observed → repetitive hrs/wk →
  automatable % → hrs + $ recoverable/yr → top opportunity (reuse `.tbl` +
  `.bar-track`).
- **Variance line** on each consolidated process detail: coverage chip ("seen in
  K of N <role>s") + one line on path divergence. Never average two genuinely
  different processes (see §7 stage 2).
- Cover/exec KPIs = cohort totals; scope = "N people across M roles".
1 ledger → skip these, use the n=1 layout.

**Optional sales-deck sections (shipped patterns, archetypes in `components.html`).**
Use when the deck is a client-facing proposal, not just an internal map:
- **Per-function "Automation Opportunities" table** on the exec summary
  (`.tbl`): columns Function, Processes, Automatable, New capacity unlocked,
  Annual savings, with a "Measured (N users)" total row and a clearly-labelled
  "Company-wide (illustrative)" extrapolated row.
- **Numbered section dividers** (`.page.divider`): a full-bleed dark interstitial
  carrying a `01`/`02`/`03` index + the section title (e.g. "Automation
  Opportunities", "Next Steps", "Appendix").
- **Engagement options / Next steps** (`.opt` cards + `.confirm` box): the
  user-supplied options (A/B/C) and an amber "To confirm before we start" box for
  client open items (deployment, regulatory). Options + open items are
  CLIENT-SUPPLIED, never invented.
- **Time-by-application appendix** (`.tba-fn` bars): per-function logo bars showing
  the top apps that make up roughly 80% of captured time per function (minimum 3
  apps), the rest bundled into a dimmed "Other" row. Source: `baseline.app_time_share[]`.

---

## 7. Build pipeline

Fan out sub-agents via `Task` where parallel (one per role to consolidate, one
per process for detail pages), then assemble; else do them in order.

1. **Load & validate.** Read all ledger(s); confirm each has `meta`,
   `exec_rollup`, `processes`, `baseline`. Thin/missing/unlabelled → ask (§1).
   Resolve report-meta + logo.
2. **Consolidate (only if 2+ ledgers).** Group observed people by
   `meta.role`/department. Within a role, cluster matching processes (same
   category + step shape + tools) into one consolidated process,
   **conservatively**: if two runs differ materially, keep them separate and note
   the divergence, **never average distinct work**. Merge each metric as a range
   across people (min–median–max) and record coverage "K of N". Recompute the
   exec rollup as the cohort sum (scope: N people, M roles); per-role rollups =
   sums within each role; never double-count an activity. When one automation
   serves several people/roles, **savings still sum per person but its cost is
   shared once**, not charged per role (else net ROI is understated). One
   sub-agent per role works well. 1 ledger → skip, scope n=1.
3. **Plan pages.** Fixed pages (+ Population & roles + Per-role rollup if cohort)
   + one detail page per top process + long-tail table. A detail page holds ~8
   step rows + a savings card; split if more.
4. **Generate `report.html`** in the working dir: one self-contained file (§3),
   clone archetypes, bind real values, enforce the honesty contract (§2), embed
   the logo (§4). Tight copy: label, number, basis, done. When many near-identical
   pages repeat (one per process), generate them from a single data array, not
   hand-edited HTML, so a shared number cannot drift between pages.
5. **Self-verify (internal QA, not the deliverable).** Ensure Playwright is
   installed (install once if missing, §8) so overflow is auto-checked, then:
   `bash assets/make-pdf.sh report.html /tmp/report-preview.pdf --shots /tmp/report-shots`
   → per-page PNGs + overflow report (exit 2 = a page overflows; split it and
   re-run) + a page-count check. The `/tmp` PDF is a throwaway overflow probe;
   **never present it as the deliverable**. Self-review vs `components.html`:
   alignment, hierarchy, every number chipped, no clipping, and every figure
   reconciles across pages (per-process → function subtotal → exec headline; any
   number repeated on multiple pages matches). Assert the rendered HTML contains
   zero em dashes. Two more cheap text checks (wired into `make-pdf.sh`): count
   `<section class="page` blocks against the planned page count, and scan for an
   accidentally duplicated money string (a regex like
   `A?\$[\d,]+\s+(<b>)?A?\$[\d,]+` catches a value printed twice).
6. **⛔ Review gate (HARD STOP).** Show the user the HTML deck: Cowork renders
   `report.html` live in-workspace; on this Mac, `open report.html` and/or show
   the stage-5 page PNGs inline. Then **stop and wait** for explicit approval.
   Collect changes, edit, re-verify (5), show again, repeat until the user
   approves. **Surgical edits: when the user asks to change one thing, change ONLY
   that property and preserve all sibling styling (color, padding, borders,
   radius); reverting means restoring the exact prior values, not a fresh
   redesign; re-render and show before/after.** **Do not proceed to stage 7 without an explicit
   "yes / approved / ship it" in this conversation.**
7. **Finalize, only after stage-6 approval.** If the user has not approved this
   turn, do NOT run this step. On approval: copy to `report-final.html`;
   `bash assets/make-pdf.sh report-final.html report-final.pdf`. Verify: page
   count == `.page` count, no overflow, backgrounds/chips intact. Report file
   paths, page count, PDF engine used, and any caveat. Write the deliverable to
   ONE canonical, human-named file and, on any regeneration, overwrite that same
   path; state the exact path back to the user. Do not scatter multiple
   differently-named copies (it leads to the user opening a stale file).

---

## 8. PDF engine (default Playwright → overflow always verified)

**Default to Playwright Chromium** so every render auto-checks overflow
(`render-pdf.mjs` measures content vs sheet height and flags clipping). If absent,
the verify/finalize steps install it once: `npm i -D playwright && npx playwright
install chromium`. `make-pdf.sh` also cross-checks expected `.page` count vs the
PDF's actual page count and warns on mismatch (any engine).

Fallbacks, only if install is impossible (offline/locked sandbox), best-first:
1. **System Chrome** `--headless=new --print-to-pdf` — good fidelity (CSS forces
   `print-color-adjust: exact`); overflow NOT measured, so **say so and eyeball
   every page**.
2. **WeasyPrint** — layout may differ; last automated resort.
3. **Manual** — HTML is print-ready; user prints to PDF (Landscape, margins None,
   Background graphics ON). Reproduces exactly.
Always state which engine ran and whether overflow was auto-verified.

---

## 9. Guardrails

- **Grounding:** every name/number/app/tool/step traces to the ledger or a
  labelled assumption in it. Omit, never invent. No click-level detail.
- **Basis everywhere** (§2); **n=1** footer; ranges on headlines.
- **Self-contained** (§3): one HTML, CSS + images + charts embedded, no JS.
- **Tight copy:** `components.html` is the ceiling for prose density; go under.
- **Confidentiality:** carry the line; never reproduce secrets, credentials, or
  personal-message content from evidence.
- **No em dashes and no colons** in report body copy (use commas, parentheses;
  en dash – only for numeric ranges); page subtitles carry no trailing period
  (unless multi-sentence).
- **Consistent footnotes:** all faint footnotes share one style (size, colour,
  line-height) across every page.
