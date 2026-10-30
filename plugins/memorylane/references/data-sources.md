# MemoryLane data sources

Skills read activity through one of two connectors. Tool names in the skills are the local ones; use the map below on remote.

## Pick the source

- **Local** tools include `search_context`. Use them when the user has the MemoryLane desktop app installed and the data downloaded locally (SQLite). Open a downloaded database with `set_db_path`; `get_db_path` shows which one is active.
- **Remote** tools include `search_activity` and `list_devices`. Use them otherwise, including when local is connected but has no data for this request. `recent-activity` is the exception: it is local only.
- **Neither connected:** stop and reply with the message in the skill's "Before you start" section.

On remote, find the person first: `list_organizations`, then `list_teams` / `list_devices` (pass the chosen `organization_id` when there are several), then use the device ID in the activity tools. If it's unclear who to analyze, ask.

## Tool map

| Purpose     | Local                                                           | Remote                                                                                                        |
| ----------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Search      | `search_context(query?, startTime, endTime, appName, limit)`    | `search_activity(query, device_id, start_time, end_time, app_name, limit)`                                    |
| Timeline    | `browse_timeline(startTime, endTime, appName, limit, sampling)` | `browse_timeline(start_time, end_time, device_id, app_name, limit, sampling)`                                 |
| Details     | `get_activity_details(ids)`                                     | `get_activity_details(ids)`, returns `ocr_text` and `not_found`                                               |
| Profile     | `get_user_context()`                                            | `get_work_profile(device_id)`                                                                                 |
| Patterns    | `list_patterns()`, `search_patterns(query)`                     | `list_patterns(device_id, team_id, organization_id, query, limit)`                                            |
| One pattern | `get_pattern_details(patternId, limit)`                         | `get_pattern_details(pattern_id, limit)`                                                                      |
| People      | none                                                            | `list_organizations()`, `list_teams(organization_id)`, `list_devices(organization_id, team_id, query, limit)` |

## How remote differs

- **Parameters:** `snake_case`. Times are ISO 8601 only, so work out "30 minutes ago" or "today" yourself. `query` and `device_id` are required on `search_activity`. Timelines allow up to 500 rows, pattern details up to 100 runs.
- **Duration and counts:** rows have real `start` and `end`, so durations are seen, not gap estimates. `total_in_range` is an exact count; if it exceeds the rows returned, the pull was sampled.
- **App names:** `app` is the raw app name, such as "Chrome", with no site. Work out the site from `window_title` or the on-screen text. `app_name` filtering does match sites.
- **Personal data:** remote text is not scrubbed. `list_devices` returns emails and nicknames. Use them only to find the device; never put them in outputs or file names. Refer to people by role.
- **Time zone and cost:** `list_organizations` gives the organization's timezone, currency and hourly rate. Read times in that timezone.
- **Permissions:** activity tools need the People and Download device data permissions, pattern tools need Patterns. On a permission error, tell the user which is missing and don't retry.
- **One device per call:** for several people, write one analysis per device, named by role (`process-analysis-<role>.md`).
