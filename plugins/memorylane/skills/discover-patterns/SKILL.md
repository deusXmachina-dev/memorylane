---
name: discover-patterns
allowed-tools: mcp__memorylane__browse_timeline, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: Discover repeated workflow patterns from screen activity and suggest automations
---

# Discover Patterns

Mine the user's screen activity for repeated workflows worth automating — via native integrations, n8n/Make/Zapier, or custom scripts. This command scans timeline data directly, applies aggressive filtering to discard casual activity, and surfaces only patterns with real automation potential.

## Instructions

### Step 1 — Scan Day by Day

Pattern detection requires **sequential context** — the order of app switches within a day reveals the loops.

Iterate backwards, one day at a time:

1. `browse_timeline(startTime="today", endTime="now", limit=50, sampling="uniform")`
2. `browse_timeline(startTime="2 days ago", endTime="1 day ago", limit=50, sampling="uniform")`
3. Continue for at least 7 days.
4. If < 10 total activities after 7 days, extend to 14 days.
5. If < 5 total activities after 14 days, tell the user there isn't enough data yet. Stop.

After each day's scan, run Step 2 on that batch before moving to the next day.

### Step 2 — Identify Candidates

For each day's batch, apply the analysis structure below, then run every candidate through the **Automation Fitness Filter**.

#### Analysis Per Batch

```
STEP 1 — App frequency
Which apps appear most? What pairs appear together?

STEP 2 — Semantic clustering
Group activities by what they describe. Are there clusters of similar descriptions?

STEP 3 — Temporal sequences
Within each cluster, do activities follow a consistent order?

STEP 4 — Repetition detection
For each sequence, does it repeat? How many times? Over what time span?

STEP 4.5 — Automation fitness check
Apply the filter below. Discard anything on the DISCARD list.
Only keep candidates that match a REPORT category.

STEP 5 — Variation analysis
Within repeated sequences, what changes between iterations? What stays the same?

STEP 6 — Automation assessment
For the "stays the same" parts — can these be scripted, scheduled, or API-driven?
```

#### Automation Fitness Filter

The core question for every candidate: **"Could a native integration, n8n/Make/Zapier workflow, or custom script replace this entire workflow end-to-end?"**

If no, discard it. If yes, classify it into one of the categories below.

**REPORT — these 5 categories only:**

| Category             | Badge Color      | Signal                                       | Example                               |
| -------------------- | ---------------- | -------------------------------------------- | ------------------------------------- |
| **Data Shuttle**     | blue `#3b82f6`   | Copy-paste structured data between apps      | Stripe → Sheets, CRM → billing        |
| **Reporting Ritual** | purple `#8b5cf6` | Same app sequence on a schedule              | Monday: analytics → chart → Slack     |
| **Review Pipeline**  | pink `#ec4899`   | Queue → cross-reference → decide             | Expense PDF → policy check → approve  |
| **Data Entry**       | orange `#f97316` | Read source, type into forms                 | Contract email → CRM fields → billing |
| **Alert Response**   | teal `#14b8a6`   | Notification → switch → act → return, 5+/day | Zendesk alert → dashboard → respond   |

**DISCARD — explicit noise list:**

- **Personal messaging** — iMessage, WhatsApp, Telegram, Discord DMs, Signal
- **Learning/studying** — docs, tutorials, papers, Stack Overflow, course platforms
- **General browsing** — Reddit, HN, news sites, shopping, social media
- **Programming** — writing code, debugging, tests, PRs, commits, code review (core creative work, not automatable)
- **Entertainment** — Spotify, Netflix, YouTube non-work, games
- **Email/Slack triage** — general inbox checking, message reading (unless it's a trigger for a specific cross-app workflow)
- **IDE usage alone** — "uses VS Code" or "writes code in Cursor" is too broad
- **File management** — unless part of a larger cross-app workflow

Maintain a running candidate list across all days. A pattern spotted on multiple days is stronger evidence — merge duplicates and increase confidence.

### Step 3 — Confirm Top Candidates

For each candidate with 3+ occurrences:

1. `search_context(query)` — widen to 30 days to verify the pattern holds beyond the scan window.
2. `get_activity_details(ids)` — only for high-confidence candidates where OCR text would reveal automation-relevant specifics (URLs, field names, data being moved). Keep to a minimum.

### Step 4 — Present Results as HTML

Rank patterns by **automation impact** — frequency x time per loop x ease of automation.

**Write the HTML to a file** — save it as `pattern-report.html` in the current working directory using the Write tool. Do NOT output raw HTML in your response. After writing the file, tell the user the report has been saved and they can open it. Repeat the pattern card block for each detected pattern.

```html
<div
  style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 720px; margin: 0 auto; color: #0f172a;"
>
  <!-- HEADER -->
  <div
    style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 16px; padding: 32px; margin-bottom: 28px; color: white;"
  >
    <div style="font-size: 24px; font-weight: 800; margin-bottom: 6px; letter-spacing: -0.5px;">
      Pattern Report
    </div>
    <div style="font-size: 14px; opacity: 0.85; line-height: 1.5;">
      {analysis_window} · {total_activities_analyzed} activities analyzed · {pattern_count} patterns
      found
    </div>
  </div>

  <!-- PATTERN CARD — repeat for each pattern -->
  <div
    style="border: 1px solid #e2e8f0; border-left: 4px solid {category_color}; border-radius: 12px; margin-bottom: 20px; background: #fff; overflow: hidden;"
  >
    <!-- Card Header -->
    <div style="padding: 20px 24px 16px; border-bottom: 1px solid #f1f5f9;">
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span
          style="display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: {category_color}; color: white; font-size: 13px; font-weight: 700; border-radius: 8px;"
          >{rank}</span
        >
        <span style="font-size: 18px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;"
          >{pattern_name}</span
        >
        <span
          style="font-size: 11px; font-weight: 600; color: white; background: {category_color}; padding: 3px 12px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.5px;"
          >{category_name}</span
        >
      </div>
      <div style="font-size: 14px; color: #64748b; line-height: 1.6;">{description}</div>
    </div>

    <!-- Stats Row -->
    <div
      style="display: flex; padding: 16px 24px; gap: 12px; flex-wrap: wrap; background: #f8fafc; border-bottom: 1px solid #f1f5f9;"
    >
      <div
        style="flex: 1; min-width: 100px; background: white; border-radius: 8px; padding: 10px 14px; border: 1px solid #e2e8f0;"
      >
        <div
          style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;"
        >
          Frequency
        </div>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a;">{frequency}</div>
      </div>
      <div
        style="flex: 1; min-width: 100px; background: white; border-radius: 8px; padding: 10px 14px; border: 1px solid #e2e8f0;"
      >
        <div
          style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;"
        >
          Time / loop
        </div>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a;">{time_per_loop}</div>
      </div>
      <div
        style="flex: 1; min-width: 100px; background: white; border-radius: 8px; padding: 10px 14px; border: 1px solid #e2e8f0;"
      >
        <div
          style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;"
        >
          Apps
        </div>
        <div style="font-size: 15px; font-weight: 700; color: #0f172a;">{apps_involved}</div>
      </div>
      <div
        style="flex: 1; min-width: 100px; background: white; border-radius: 8px; padding: 10px 14px; border: 1px solid #e2e8f0;"
      >
        <div
          style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;"
        >
          Effort
        </div>
        <div style="font-size: 15px; font-weight: 700; color: {effort_color};">{effort}</div>
      </div>
    </div>

    <!-- Card Body -->
    <div style="padding: 16px 24px 20px;">
      <!-- Loop Structure -->
      <div
        style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;"
      >
        <div
          style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600;"
        >
          Loop structure
        </div>
        <div
          style="font-size: 13px; color: #334155; font-family: 'SF Mono', Monaco, Consolas, monospace; line-height: 1.6;"
        >
          {loop_structure}
        </div>
      </div>

      <!-- What Varies vs What's Constant -->
      <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
        <div
          style="flex: 1; min-width: 200px; background: #fef3c7; border-radius: 8px; padding: 12px 16px;"
        >
          <div
            style="font-size: 10px; color: #92400e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600;"
          >
            What varies
          </div>
          <div style="font-size: 13px; color: #78350f; line-height: 1.5;">{what_varies}</div>
        </div>
        <div
          style="flex: 1; min-width: 200px; background: #d1fae5; border-radius: 8px; padding: 12px 16px;"
        >
          <div
            style="font-size: 10px; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; font-weight: 600;"
          >
            What's constant
          </div>
          <div style="font-size: 13px; color: #064e3b; line-height: 1.5;">
            {what_stays_constant}
          </div>
        </div>
      </div>

      <!-- Automation Suggestion -->
      <div
        style="background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%); border: 1px solid #c7d2fe; border-radius: 8px; padding: 16px;"
      >
        <div
          style="font-size: 11px; font-weight: 700; color: #6366f1; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;"
        >
          Automation suggestion
        </div>
        <div style="font-size: 14px; color: #1e293b; line-height: 1.6; margin-bottom: 10px;">
          {automation_approach}
        </div>
        <div
          style="display: inline-block; background: white; border: 1px solid #c7d2fe; border-radius: 6px; padding: 4px 12px; font-size: 12px; color: #4f46e5; font-weight: 600;"
        >
          {automation_method}
        </div>
      </div>
    </div>
  </div>
  <!-- END PATTERN CARD -->

  <!-- SUMMARY FOOTER -->
  <div
    style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border-radius: 12px; padding: 20px 24px; border: 1px solid #bbf7d0;"
  >
    <div style="font-size: 14px; color: #166534; line-height: 1.5;">
      <strong>Estimated time savings:</strong> {total_time_savings} per week if all suggested
      automations are implemented.
    </div>
  </div>
</div>
```

#### Template Variables

- `{rank}` — the pattern's position number, ranked by automation impact (1 = highest)
- `{category_name}` — one of: Data Shuttle, Reporting Ritual, Review Pipeline, Data Entry, Alert Response
- `{category_color}` — the badge color from the table above (`#3b82f6`, `#8b5cf6`, `#ec4899`, `#f97316`, `#14b8a6`)
- `{automation_method}` — one of: API script, n8n/Make/Zapier, cron + script, browser automation, webhook

**Effort colors** for `{effort_color}`:

| Effort | Color             |
| ------ | ----------------- |
| Easy   | `#10b981` (green) |
| Medium | `#f59e0b` (amber) |
| Hard   | `#ef4444` (red)   |

If no patterns survive the filter, say so directly: "No automatable patterns found in the last N days. Your activity was mostly [programming / browsing / messaging / etc.]. Try again after a week that includes cross-app operational workflows."

### Step 5 — Prompt for Next Steps

After saving the HTML report, use the `AskUserQuestion` tool to present two interactive prompts. Build the first question dynamically from the discovered patterns — each pattern becomes a selectable option.

```json
{
  "questions": [
    {
      "question": "Which patterns are interesting to you?",
      "header": "Patterns",
      "options": [
        {
          "label": "1. {pattern_name}",
          "description": "{short_description}"
        },
        {
          "label": "2. {pattern_name}",
          "description": "{short_description}"
        }
      ],
      "multiSelect": true
    },
    {
      "question": "What should I do next with the selected patterns?",
      "header": "Next step",
      "options": [
        {
          "label": "Pattern to PDF",
          "description": "Create a process description document as PDF, via /pattern-to-pdf"
        },
        {
          "label": "Automation instructions",
          "description": "Write step-by-step automation instructions, via /automation-instructions"
        }
      ],
      "multiSelect": true
    }
  ]
}
```

Generate one option per discovered pattern in the first question (up to 4 — if more than 4 patterns, list the top 4 by automation impact and mention the rest in descriptions). Then invoke the corresponding command for each selected pattern.

## Calibration Examples

These show the level of specificity to aim for. Each example: observable screen behavior → concrete automation suggestion.

### REPORT — Automatable Workflows

**Finance & Accounting**

1. User downloads bank statement CSV, opens QuickBooks, manually enters each transaction, cross-references against invoices in Google Drive. Every Monday morning, ~45 min. → Bank feed integration with auto-matching rules. **(Data Entry)**

2. User pulls revenue numbers from Stripe dashboard, copies into a Google Sheet, applies formulas, then pastes the summary into a Slack channel for the weekly finance update. → Scheduled script that queries Stripe API, computes metrics, posts to Slack. **(Reporting Ritual)**

3. User reviews each expense report by opening the PDF, checking line items against policy in a separate browser tab, then entering approval/rejection in the expense tool. 10-15 reports per batch. → Policy-checking script that pre-flags violations, surfaces only exceptions for human review. **(Review Pipeline)**

**Operations & Back-Office**

4. User receives client onboarding forms via email, manually copies fields (name, company, billing address, tax ID) into CRM, then into billing system, then sends a welcome email template with the same details. Per new client, ~20 min. → Intake form that auto-populates CRM + billing via API, triggers welcome email. **(Data Entry)**

5. User checks Zendesk queue every 2 hours, scans for high-priority tickets, copies ticket summaries into a Slack channel for the ops team. → Webhook that auto-posts P0/P1 tickets to Slack with summary and link. **(Alert Response)**

6. User exports weekly sales data from CRM, imports into Excel, builds a pivot table, screenshots the chart, pastes into a PowerPoint slide deck for the Monday review. Every Friday, ~1 hour. → Automated report generation from CRM API to formatted slides. **(Reporting Ritual)**

7. User checks LinkedIn, Crunchbase, and the company website before every sales call to build a prospect brief in Notion. 3-5 calls/day, ~10 min each. → Enrichment script that auto-generates prospect briefs from company domain. **(Data Shuttle)**

**HR & Compliance**

8. User receives signed offer letters via DocuSign, downloads PDF, enters start date + salary + role into HRIS, then creates accounts in Slack + Google Workspace + Jira. Per new hire, ~30 min. → Webhook on DocuSign completion triggers HRIS entry + account provisioning. **(Data Entry)**

9. User opens the compliance training dashboard weekly to check which employees haven't completed required training, then sends individual reminder emails. → Scheduled check with auto-reminder emails for overdue training. **(Reporting Ritual)**

**Engineering**

10. User scrapes GitHub stargazers, cleans data in Sheets, imports to email tool, writes personalized emails with Claude. → End-to-end script from repo URL to campaign launch. **(Data Shuttle)**

11. User opens Datadog dashboard 4-5 times/day to check error rates after a deploy. → Slack alert triggered by error rate threshold, with auto-rollback on spike. **(Alert Response)**

### DISCARD — Not Automatable

These would appear as repeated patterns but should **never** be reported:

- User chats with friends on iMessage and WhatsApp throughout the day. _(Personal messaging — not a workflow)_
- User reads Hacker News, Reddit, and tech blogs for 30 min each morning. _(General browsing — leisure/learning)_
- User writes code in Cursor, runs tests in terminal, pushes to GitHub. _(Programming — core creative work, not automatable)_
- User studies React docs, follows a tutorial, reads Stack Overflow answers. _(Learning — not a repeatable operational task)_
- User reviews PRs on GitHub, leaves comments, approves/rejects. _(Code review — requires human judgment on creative work)_
- User edits hero.tsx → Chrome preview → CSS tweak → preview again. _(Programming iteration loop — creative work)_
- User listens to Spotify while working, occasionally switching tracks. _(Entertainment — background noise)_
- User checks email inbox periodically, reads and archives messages. _(Email triage — too broad unless triggering a specific cross-app workflow)_

## Notes

- **Aggressive filtering philosophy** — most screen activity is not automatable. Programming, browsing, messaging, and learning are valuable human activities but not workflow automation candidates. This command deliberately has a high bar: if a pattern doesn't fit one of the 5 REPORT categories, it doesn't make the cut.
- **Summaries are the primary source of truth.** Reserve `get_activity_details` for high-confidence candidates only.
- **Privacy** — never reproduce raw OCR (passwords, API keys, personal messages) in the output.
- **Granularity sweet spot** — specific enough to write an automation for, general enough to be a repeatable process. "Writes code in Cursor" is too broad. "Downloads CSV from Stripe → copies into Sheets → posts summary to Slack" is just right.
