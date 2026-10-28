# Activity-Summary Prompt Experiments

Running log, newest first. Each entry is one hypothesis scored with `/summary-experiment`:
two baseline runs vs two candidate runs on the semantic-summary fixtures, free checks from
`eval-summaries`, pairwise judgment per rubric v1, user review. Raw runs, compare files and
judgment files live in the evals repo under `evals/semantic-summary/results/`. Model
sweeps are in `summary-model-benchmark.md`.

## 2026-10-28 — prompt rewrites P1–P3 (after submit-keys)

Generic rewrites on top of submit-keys, gpt-6-luna image pipeline, 2 runs each, all 17 fixtures. No wording taken from goldens or fixtures.

| Variant         | Change                                                                                                                            | Mention% | Hard fails | Det pass | Verdict                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------: | -------: | ---------------------------------------- |
| submit-keys (A) | —                                                                                                                                 |     70.5 |        0.5 |    96.0% | incumbent                                |
| P1 `1121112`    | Rules rewritten outcome-first: report visible state changes, submit key + content shown = done, skip passed-by UI, prefer short   |     66.4 |          0 |    94.9% | Lost on must-mention, not judged         |
| P2 `eacd11e`    | P1 + each snapshot labelled "Snapshot i of n at t+Xs", timeline cap 16 → 40                                                       |     64.5 |        0.5 |    95.7% | Lost on must-mention, not judged         |
| P3 `0761deb`    | submit-keys + one state-change rule; timeline says "text entry" / "pointer selection" instead of "typing session" / "mouse click" |     71.1 |        0.5 |    97.4% | Judged: A 16 · B 9 · tie 55 of 80 — lost |

- P1/P2 dropped product names and identifiers the old "be specific: name files, URLs, UI elements" rule produced (app names, ticket ids, a vendor). Removing a specificity rule costs recall even when the new rules are better written.
- P3 judgment: `wrong-action` 9 / 9, `wrong-detail` A 6 / B 9. The extra rule added detail lost to padding, not new facts. File: `compare-2026-10-28T09-57-58-202Z-submit-keys-image-vs-2026-10-28T12-44-52-651Z-prompt-p3-image.judgment.md`.
- First P1/P2 attempt lost 55/81 activities to a DNS outage (`ENOTFOUND openrouter.ai`); discarded and rerun.
- This judgment scored submit-keys with 9 `wrong-action`, the earlier one with 10 for the same runs: cross-session judge noise is about ±1–4 per tag.

**Verdict:** Keep submit-keys. Next lever is not wording: both arms share the same unsolved cases (state changes with no key trace, a sent message in a busy thread).

## 2026-10-28 — submit-keys

**Hypothesis:** In enriched-timeline, Enter fixed every "drafted vs sent" case, but `typed text` and bare clicks were read as edits that never happened. Rendering only the submit-class key runs (Enter, Cmd/Ctrl+Enter, paste, save) on top of today's `typing session (N keys)` line should keep the send signal and cut `wrong-action` on message and form activities (spend-check, test-tenant, categorise-batch, smartwings, win-claude-to-email), without new invented edits.

**Change:** `src/main/semantic/prompt.ts` — `describeInteraction` appends the submit-class runs to the keyboard line (`typing session (8 keys): submitted with Cmd/Ctrl+Enter`); everything else unchanged. Commit `a31effd`.

**Baseline:** `2026-10-28T09-30-13-385Z-baseline-image-5356aac`, `2026-10-28T09-30-44-712Z-baseline-image-5356aac` · **Candidate:** `2026-10-28T09-57-58-202Z-submit-keys-image`, `2026-10-28T09-58-45-840Z-submit-keys-image` · **Judgment:** `compare-2026-10-28T09-30-13-385Z-baseline-image-5356aac-vs-2026-10-28T09-57-58-202Z-submit-keys-image.judgment.md`

gpt-6-luna, image pipeline (6 snapshots), all 17 fixtures (80 golden-matched activities), no LLM judge. Judged on image because image is the ship candidate (see `summary-model-benchmark.md`, 2026-10-28).

**Result:**

| Metric (per run, 17 shared fixtures) | A baseline | B submit-keys |    Δ |
| ------------------------------------ | ---------: | ------------: | ---: |
| Must-mention recall                  |        70% |           70% | 0 pt |
| Hard fails                           |        1.5 |           0.5 | −1.0 |
| Det pass                             |        96% |           96% | 0 pt |
| Segmentation                         |       100% |          100% | 0 pt |
| Cost                                 |    $0.0830 |       $0.0835 |   +0 |

| Pairwise judgment (80 activities) |   A |   B |
| --------------------------------- | --: | --: |
| Wins                              |  13 |  22 |
| Ties                              |  45 |  45 |
| `wrong-action`                    |  14 |  10 |
| `missed-action`                   |  16 |  13 |
| `wrong-detail`                    |   8 |   9 |
| `vague`                           |   2 |   3 |
| `over-long`                       |  16 |  13 |

Net wins B − A = +9 (gate ≥ +8). `wrong-action` down, hard fails down, must-mention flat.

The same prompt on the video pipeline (gemini-3.1-flash-lite, `2026-10-28T09-58-48-542Z-submit-keys-video`, `2026-10-28T09-59-00-191Z-submit-keys-video`) was flat to −2 pt on must-mention and not judged.

**Verdict:** Passes the gates on image. Ship pending user sign-off.

- All 13 B losses are a detail one B run dropped (a price, a command, a label), not a new invented action: run variance.
- Every B `wrong-action` is shared with A (ties or B wins). The October failure mode (typed text promoted to edits) did not return.
- Still unsolved in both arms: state changes with no key trace (category picked, stage set, DM sent in a busy thread).

## 2026-10-20 — enriched-timeline

**Hypothesis:** The interaction timeline is the only non-visual evidence the summarizer gets, and it is lossy (`typing session (N keys)`, `mouse click`) while the rules forbid mentioning key counts. Rendering the already-captured `keySequence` / `clickSequence` classes (typed, Enter, paste, delete, save; click, double-click, right-click) and the page URL should raise must-mention recall on edit-heavy activities (lead-gen sheet cells, failed-invoice form, categorise-batch) and reduce wrong end-states, without touching the rules.

**Change:** `src/main/semantic/prompt.ts` — `describeInteraction` renders key and click classes instead of counts; `app_change` lines and the Context block carry the URL (origin + path). Commit `51e6951`, reverted in `8bc844f`.

**Baseline:** `2026-10-20T13-04-42-929Z-baseline-bfd6783`, `2026-10-20T13-04-44-267Z-baseline-bfd6783` · **Candidate:** `2026-10-20T13-06-09-416Z-enriched-timeline`, `2026-10-20T13-06-10-246Z-enriched-timeline` · **Judgment:** `compare-2026-10-20T13-04-42-929Z-baseline-bfd6783-vs-2026-10-20T13-06-09-416Z-enriched-timeline.judgment.md`

gemini-3.1-flash-lite, video pipeline, all 12 fixtures (61 golden-matched activities), no LLM judge.

**Result:**

| Metric (per run, 12 shared fixtures) | A baseline | B enriched |        Δ |
| ------------------------------------ | ---------: | ---------: | -------: |
| Must-mention recall                  |        65% |        65% |     0 pt |
| Hard fails                           |        2.5 |        1.0 |     −1.5 |
| Det pass                             |        93% |        92% |    −1 pt |
| Segmentation                         |       100% |       100% |     0 pt |
| Cost                                 |    $0.0542 |    $0.0549 | +$0.0007 |

| Pairwise judgment (61 activities) |   A |   B |
| --------------------------------- | --: | --: |
| Wins                              |  14 |   9 |
| Ties                              |  38 |  38 |
| `wrong-action`                    |  13 |  16 |
| `missed-action`                   |  14 |  13 |
| `wrong-detail`                    |  11 |  15 |
| `vague`                           |   9 |   7 |

Net wins B − A = −5 (gate needs ≥ +6). B's `wrong-action` count is higher. Hard fails improve, cost and must-mention are flat.

**Verdict:** Do not ship. Reverted.

- The Enter signal works: B wins every "drafted vs sent" case in Slack and Claude chat (spend-check 7, test-tenant 2, categorise 4 and 10, smartwings 3). The baseline calls a sent message "drafted" in all of them.
- `typed text` in a sheet, dashboard, diff view or the address bar is promoted to an edit or a filled form (lead-gen 3, categorise 9, coding 3, smartwings 1 and 2). Typing a URL into the omnibox reads as a sheet entry.
- Run variance: baseline vs baseline already flips a fact on 17 activities and moves per-fixture must-mention by up to 17 points; the overall row is stable. Only the overall row and the pairwise judgment are meaningful.
- Neither arm sees state changes with no typed trace: resolved comment, Todo → In Progress, dismissed requirements, a rejected form, a screenshot shortcut.

Next hypothesis: render only the submit-class runs (Enter, Cmd/Ctrl+Enter, save, paste) and drop `typed text` and bare clicks, so the model keeps the send signal without a licence to invent edits.
