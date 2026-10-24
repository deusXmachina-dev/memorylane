# Activity-Summary Prompt Experiments

Running log, newest first. Each entry is one hypothesis scored with `/summary-experiment`:
two baseline runs vs two candidate runs on the semantic-summary fixtures, free checks from
`eval-summaries`, pairwise judgment per rubric v1, user review. Raw runs, compare files and
judgment files live in the evals repo under `evals/semantic-summary/results/`. Model
sweeps are in `summary-model-benchmark.md`.

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
