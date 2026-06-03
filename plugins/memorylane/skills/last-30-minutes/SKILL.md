---
name: last-30-minutes
allowed-tools: mcp__memorylane__browse_timeline, mcp__memorylane__search_context, mcp__memorylane__get_activity_details
description: Summarize what you've been doing in the last 30 minutes.
---

# Recent Activity

Summarize the user's recent screen activity.

## Instructions

### Step 1 — Fetch Recent Activity

Call `browse_timeline(startTime="30 minutes ago", endTime="now", limit=50, sampling="recent_first")`.

### Step 2 — Handle Empty Results

- **If nothing returned**: Widen the window to `browse_timeline(startTime="2 hours ago", endTime="now", limit=50, sampling="recent_first")`.
- **If the wider window also returns nothing**: Report that MemoryLane may not be capturing (the app might not be running, or there has been no screen activity). Stop here.
- **If the wider window returns results but the 30-minute window didn't**: Note the gap to the user (e.g., "No activity in the last 30 minutes, but here's what you were doing earlier").

### Step 3 — Group and Summarize

From the returned entries:

1. Identify distinct apps from the activity summaries.
2. Cluster entries by task — use the summary text to group related activities together.
3. Estimate approximate time spent on each cluster from the timestamps of its entries.
4. Order groups by recency (most recent first).

### Step 4 — Drill Into Details (only if needed)

Only call `get_activity_details(ids)` when a summary is ambiguous and the exact on-screen text would genuinely help clarify what the user was doing. Do not fetch OCR speculatively.

### Step 5 — Present the Summary

Format as a brief narrative followed by bullet points:

```
**Last 30 minutes** (N activities recorded)

You were primarily working on [main task].

- **[App Name]** (~X min) — [what you were doing]
- **[App Name]** (~X min) — [what you were doing]
```

If the results came from the wider 2-hour window, adjust the heading accordingly.

## Notes

- **Summaries are the primary source of truth.** They are pre-generated from the captured activity and are sufficient for most reporting. Reserve `get_activity_details` for ambiguous cases.
- Use `search_context(query)` if the user asks follow-up questions like "what was I doing in Chrome?" or "find that thing I was reading about X".
- `recent_first` sampling is used instead of `uniform` because the user cares most about what just happened, and the window is short enough that uniform sampling would not add value.
