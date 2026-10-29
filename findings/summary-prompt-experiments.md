# Activity-Summary Prompt Experiments

Running log, newest first. Each entry is one hypothesis scored with `/summary-experiment`:
two baseline runs vs two candidate runs on the semantic-summary fixtures, free checks from
`eval-summaries`, pairwise judgment per rubric v1, user review. Raw runs, compare files and
judgment files live in the evals repo under `evals/semantic-summary/results/`. Model
sweeps are in `summary-model-benchmark.md`.

## 2026-10-28 — snapshot dedupe threshold and follow-ups (after submit-keys)

**Hypothesis:** The near-duplicate filter (`VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT`, 8%) is what limits snapshots, not the cap of 6 (only 13 of 79 activities reached 6). Small on-screen changes that carry the outcome (a status flip, a sent message, a picked file) fall under 8% and are dropped. A lower threshold should raise must-mention without a new prompt. The threshold is used only by semantic snapshot selection, not by capture, so the eval gain carries to the app.

gpt-6-luna image pipeline, submit-keys prompt, all 17 fixtures. New eval flag `--visual-threshold N` (`exp/dhash` `6191be4`).

| Arm                                  | Runs | Mention%    | Hard fails | Imgs/act |         $/run | Verdict                                      |
| ------------------------------------ | ---: | ----------- | ---------: | -------: | ------------: | -------------------------------------------- |
| submit-keys, 8% (A)                  |    2 | 70.3 / 70.6 |      1 / 0 |     3.19 |        0.0835 | incumbent                                    |
| 4%                                   |    2 | 70.3 / 72.8 |      1 / 1 |     3.65 |        0.0931 | —                                            |
| **2%**                               |    2 | 78.0 / 74.4 |      0 / 1 |     3.94 |        0.0988 | **Judged B 27 · A 14 · tie 37 of 78 — pass** |
| 1%                                   |    1 | 76.0        |          0 |     4.23 |        0.1048 | no gain over 2%                              |
| 2% + cap 10                          |    2 | 73.5 / 74.4 |      1 / 2 |     4.75 |        0.1144 | lost                                         |
| 2% + outcome frames (submit-frames)  |    2 | 74.6 / 69.8 |      1 / 2 |     4.82 |        0.1158 | lost                                         |
| 2% + reasoning effort low / high     |  1+1 | 74.9 / 74.3 |      1 / 0 |     3.94 | 0.090 / 0.103 | noise; low is 9% cheaper                     |
| 2% + vocab prompt (`9dc9606`)        |    2 | 71.2 / 76.6 |      0 / 0 |     3.94 |        0.0996 | neutral                                      |
| 2% + length rule 20-80 words         |    2 | 69.8 / 70.8 |      0 / 0 |     3.94 |        0.0973 | lost (35 words, recall down)                 |
| 2% + "one sentence for a quick look" |    2 | 75.3 / 67.2 |      0 / 0 |     3.94 |        0.0985 | lost                                         |
| gemma-4-31b-it, 2% (cheap point)     |    2 | 69.0 / 68.0 |      1 / 0 |     3.94 |        0.0148 | +5 pt over Gemma at 8% (60–66)               |

- 2% vs submit-keys: `wrong-action` A 7 / B 6, `missed-action` A 14 / B 10, `wrong-detail` A 14 / B 19, `vague` A 3 / B 0, `over-long` A 5 / B 7. Net +13 = 17% of judged activities; all gates pass.
- **Candidate vs production** (video gemini-3.1-flash-lite, prompt `5356aac`): judged B 47 · A 30 · tie 1 of 78. `wrong-action` A 12 / B 7, `missed-action` A 15 / B 12, `wrong-detail` A 21 / B 19, `over-long` A 2 / B 23. Mention 68 → 76%, hard fails 2.0 → 0.5, $0.071 → $0.099 per run (+39%). Most production wins are the candidate padding trivial activities.
- Ship branch + "skip navigation menus, sidebars, page layout and incidental listings" rule (`exp/no-chrome` `c9ce192`), 2 runs: 75.3 / 74.5 mention, 46 words. Judged vs ship B 19 · A 15 · tie 44 of 78, `wrong-action` A 7 / B 9, `over-long` A 8 / B 6 — fails (net 5%, wrong-action up). Third length/padding rule to lose; padding stays.
- 15-50 words for activities under 30 s (`exp/short-floor` `5b95e14`), 2 runs: 73.6 / 73.9 mention overall; on the 45 short activities words 43 → 30 but mention 84.5 → 78.7. Fourth length rule to lose: the words carry must-mention facts.
- **OCR screen text in the prompt** (`exp/screen-text` `faf6666`; the transformer already OCRs a frame near the end for search, now also passed to the summarizer as a `## Screen text` section, 4k chars, scrubbed). Judged vs ship B 25 · A 12 · tie 41 of 78, `wrong-detail` A 25 / B 10, `wrong-action` 7 / 7, `over-long` 13 / 18; "Pet Ungar" misreads 3–4 → 0–1 per run. Must-mention over 4 runs each: 74.1 mean (72.6–75.7) vs ship 76.4 (74.4–78.0) — a real ~2 pt dip, so the gate fails on must-mention while judged quality clearly improves. Cost +4%. Not shipped; user decision.
- Screen text as a spelling reference only (`2f7da74`, "write from the media, then use this only to correct spelling"): 74.1 / 73.5 mention, misreads still fixed. The dip comes from the OCR block's presence, not its wording.
- Screen text on gemma-4-31b-it: 69.3 / 70.0 mention vs 68–69 without, hard fails 2 / 2 vs 1 / 0, +26% cost. Gemma already reads names correctly; no meaningful gain.
- Change-zoom (enlarged crop of the region that changed between the last two snapshots, `exp/zoom`): 73.6 mention, +10% cost, misreads unchanged. Lost.
- **Ceiling:** gemini-3.8-flash on the ship config (1 run): 77.9 mention, 0 hard fails, $0.528/run vs ship 76.1–77.2 at $0.099. The ship config sits at the quality ceiling of available models; remaining gains need better inputs or goldens, not a bigger model.
- Reasoning effort low, 2 runs: 74.9 / 72.9 mention (default 76–77), $0.091/run, p50 call 6.0 s vs 9.4 s at default (eval concurrency, relative only). A latency/cost option, not a quality one; not shipped.
- With 2%, 24 of 79 activities hit the cap of 6, yet cap 10 still loses: more frames past 6 dilute rather than inform.
- Outcome frames add images but not the right ones once dedupe keeps small changes.
- Length rules cut padding but always cost recall (P1, both length variants). Padding is the price of the specificity rule.
- vocab prompt + 2% on other models: claude-haiku-5.5 80/79 mention but 13 hard fails ("typed", "cursor") and 75 words; glm-5.3-flash 79/78, 4 hard fails, $0.175/run; gemini-3-flash-preview image 77, $0.221/run. None beats Luna at 2% on the gates. gemini-3-flash-preview video with submit-keys: 75.8, 4 hard fails, $0.145.
- One vocab+2% batch hit a DNS outage (33–47 empty per run); discarded and rerun.
- Judgment files: `compare-2026-10-28T09-57-58-202Z-submit-keys-image-vs-2026-10-28T14-34-00-034Z-dhash2-image.judgment.md`, `compare-2026-10-28T09-30-36-179Z-baseline-video-5356aac-vs-2026-10-28T14-34-00-034Z-dhash2-image.judgment.md`.
- Ship branch `feat/summary-quality` `e095a0e` (defaults only, no override flags): 77.2 / 76.1 mention, 0 / 1 hard fails, $0.099/run.
- OpenRouter spend for the day: $7.03 of $10 (key usage + BYOK).

**Verdict:** Ship snapshot dedupe 2% with submit-keys on the gpt-6-luna image pipeline. It needs the pipeline switch for existing installs (stored `semanticPipelineMode` / video pick survive a `MODEL_DEFAULTS_VERSION` bump) and the 2% default reaching installs that persisted `visualThreshold: 8`.

## 2026-10-28 — prompt rewrites P1–P3 (after submit-keys)

Generic rewrites on top of submit-keys, gpt-6-luna image pipeline, 2 runs each, all 17 fixtures. No wording taken from goldens or fixtures.

| Variant         | Change                                                                                                                            | Mention% | Hard fails | Det pass | Verdict                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------: | ---------: | -------: | ----------------------------------------- |
| submit-keys (A) | —                                                                                                                                 |     70.5 |        0.5 |    96.0% | incumbent                                 |
| P1 `1121112`    | Rules rewritten outcome-first: report visible state changes, submit key + content shown = done, skip passed-by UI, prefer short   |     66.4 |          0 |    94.9% | Lost on must-mention, not judged          |
| P2 `eacd11e`    | P1 + each snapshot labelled "Snapshot i of n at t+Xs", timeline cap 16 → 40                                                       |     64.5 |        0.5 |    95.7% | Lost on must-mention, not judged          |
| P3 `0761deb`    | submit-keys + one state-change rule; timeline says "text entry" / "pointer selection" instead of "typing session" / "mouse click" |     71.1 |        0.5 |    97.4% | Judged: A 16 · B 9 · tie 55 of 80 — lost  |
| P4 `b612f35`    | Same rules, no first person ("What was I working on?" gone), duplicates merged, Task section dropped; ~410 → 265 words            |     71.0 |          0 |        — | Judged: A 18 · B 16 · tie 47 of 81 — lost |

- P1/P2 dropped product names and identifiers the old "be specific: name files, URLs, UI elements" rule produced (app names, ticket ids, a vendor). Removing a specificity rule costs recall even when the new rules are better written.
- P3 judgment: `wrong-action` 9 / 9, `wrong-detail` A 6 / B 9. The extra rule added detail lost to padding, not new facts. File: `compare-2026-10-28T09-57-58-202Z-submit-keys-image-vs-2026-10-28T12-44-52-651Z-prompt-p3-image.judgment.md`.
- P4 judgment: `wrong-action` A 7 / B 9, `wrong-detail` A 10 / B 17, `over-long` A 4 / B 7. Summaries were already third-person (only quoted titles contained "I"), so dropping the first-person framing changed nothing visible; merging the verb-intensity and submitted-vs-drafted rules into one sentence weakened both. File: `compare-2026-10-28T09-57-58-202Z-submit-keys-image-vs-2026-10-28T13-34-06-585Z-prompt-p4-image.judgment.md`.
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
