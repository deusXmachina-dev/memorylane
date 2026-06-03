---
name: time-report
allowed-tools: mcp__memorylane__browse_timeline, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: Generate a time report grouped by client/project
---

# Time Report

Generate a time report grouped by client and project with approximate durations. The output is what you'd submit to a client or paste into a timesheet — hours per client per day, with enough detail to justify the line items.

## Instructions

### Step 1 — Ask for Client List and Time Range

Before fetching any data, ask the user two things:

1. **Clients** — "Which clients or projects should I track? List the names and I'll match screen activity to each one." If the user doesn't have a list, offer to scan first and propose clients based on what appears in the data.
2. **Time range** — "What period should the report cover?" Default to "today" if the user doesn't specify. Accept natural language ("last week", "Monday to Wednesday", "February 1–14").

Store both answers — you'll use the client list to classify time blocks and the range to set `startTime`/`endTime`.

### Step 2 — Fetch Activity

For the requested time range, iterate **one day at a time** to preserve sequential context:

```
browse_timeline(startTime="<day start>", endTime="<day end>", limit=200, sampling="uniform")
```

If the response header shows results were sampled (i.e., more entries exist), re-fetch that day with a higher limit (up to 1000).

For a single-day report, one call is enough. For multi-day ranges, iterate day by day and process each batch before moving on.

### Step 3 — Handle Empty or Sparse Results

- **No activities returned for the entire range**: Report that MemoryLane may not have been running, or that no screen activity was captured. Stop here.
- **Fewer than 5 activities for a given day**: Include the day but note the data is limited.
- **No activities for some days in the range**: Mark those days as "No data" rather than omitting them.

### Step 4 — Identify Time Blocks

Walk through each day's activities chronologically:

1. Group consecutive entries that share the same app and task into blocks.
2. Detect transitions — when the app or task changes, start a new block.
3. Mark gaps of 15+ minutes between entries as breaks. Gaps of 60+ minutes → extended breaks (e.g., lunch).
4. Estimate each block's duration from the timestamps of its first and last entry.

### Step 5 — Assign Client and Project Labels

Map each time block to a client from the user's list:

- Match by app name, URL, project folder, or keywords in the activity summary.
- Code editor entries → match project/repo name against client list.
- Browser entries → match site/domain or topic against client list.
- If a block doesn't match any client, label it "Internal" or "Unassigned".
- If a block is ambiguous, call `get_activity_details(ids)` on 1–2 representative entries to inspect OCR text. Keep this to genuinely ambiguous cases.

If the user skipped providing a client list in Step 1 (scan-first mode), propose a client list based on the distinct projects/apps you see, ask the user to confirm or adjust, then re-classify.

### Step 6 — Present the Report

Format as a markdown table, grouped by client:

```
## Time Report — [Date range]

### [Client A]

| Date | Time Range | Project / Task | Duration | Details |
|---|---|---|---|---|
| Mon Feb 23 | 9:00 AM – 10:15 AM | API integration | 1h 15m | Editing api.ts, testing endpoints |
| Mon Feb 23 | 2:00 PM – 3:30 PM | API integration | 1h 30m | Debugging auth flow |
| Tue Feb 24 | 10:00 AM – 11:45 AM | Dashboard | 1h 45m | Building chart components |

**Subtotal**: 4h 30m

### [Client B]

| Date | Time Range | Project / Task | Duration | Details |
|---|---|---|---|---|
| Mon Feb 23 | 11:00 AM – 12:00 PM | Landing page | 1h 0m | Designing hero section |

**Subtotal**: 1h 0m

### Internal / Unassigned

| Date | Time Range | Activity | Duration | Details |
|---|---|---|---|---|
| Mon Feb 23 | 10:15 AM – 10:30 AM | *Break* | 15m | |
| Tue Feb 24 | 9:00 AM – 9:45 AM | Email + Slack | 45m | |

**Subtotal**: 1h 0m

---

**Total tracked time**: 6h 30m
**Breaks**: 15m
**Coverage**: Mon Feb 23 – Tue Feb 24
```

If the range is a single day, drop the Date column. If the report period is still in progress, note it's partial.

### Step 7 — Handle Follow-Up Requests

If the user asks follow-up questions after the report:

- Use `search_context(query)` for client-specific or project-specific queries (e.g., "how long did I spend on Client A's API this week?").
- Use `get_activity_details(ids)` when they want exact on-screen text from a specific time block.
- If the user wants to reassign a block to a different client, adjust and regenerate the affected section.

## Notes

- `"today"` resolves to midnight local time on the server.
- **Gap detection is approximate.** MemoryLane captures are event-driven (triggered by user interaction and visual changes), not taken at fixed intervals. A 15-minute gap may mean the user was idle, or that the screen content didn't change enough to trigger a capture.
- **Duration estimates are approximate** for the same reason — they are derived from capture timestamps, not from continuous time tracking.
- **Client matching is best-effort.** It relies on app names, URLs, folder names, and summary text. If a user works on multiple clients in the same tool (e.g., same IDE), OCR details may be needed to distinguish them.
