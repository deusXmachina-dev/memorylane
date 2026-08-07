# Task-Mining Benchmark — model sweep

Date: 2026-08-05 (supersedes the 2026-07-03 sweep, kept at the bottom)
Eval: `npm run eval-tasks`, scan-only, over the 6 committed fixtures
(`evals/task-mining/fixtures/`). 3 full sweeps per model, one process per model.
Recall = keep blocks reproduced (≥50% of a block's activity ids inside one
sighting). A run that fails outright is charged as a zero-recall day.
Priority: false negatives worse than false positives.

## Verdict

**`deepseek/deepseek-v4-flash-0731` should replace `minimax/minimax-m3` as the
default.** It beats the incumbent by 14pp recall (78% vs 64%) at **3.5× less
cost** ($0.0051 vs $0.0177/day), with better id-precision and no run failures —
minimax lost a whole day to the 20-minute request timeout.

`nex-agi/nex-n2-pro` is the recall leader (89%, and the only model that reliably
catches repeated occurrences) but costs 4× deepseek and pays for the recall with
noise: id-precision 84% and 0.33 reject-blocks reproduced per day, the second
worst on the board. Pick it only if the extra triage is acceptable.

## Scorecard

Two recall columns, both computed from the same runs — see "Golden mismatch" below.

| Model                               | Shipped-gate recall (12) | per-sweep   | Widened-gate recall (41) | Reject-repro/day | Sightings/day | Id-prec | Ground-recall |       $/day | Wall/day |
| ----------------------------------- | -----------------------: | ----------- | -----------------------: | ---------------: | ------------: | ------: | ------------: | ----------: | -------- |
| **nex-agi/nex-n2-pro**              |          **89%** (32/36) | 92%/83%/92% |             26% (32/123) |             0.33 |           1.6 |     84% |           96% |     $0.0203 | 2.4 min  |
| xiaomi/mimo-v2.5 †                  |              79% (19/24) | 75%/83%     |              23% (19/82) |             0.00 |           1.2 |    100% |           95% |     $0.0073 | 4.2 min  |
| **deepseek/deepseek-v4-flash-0731** |          **78%** (28/36) | 83%/67%/83% |             23% (28/123) |             0.06 |           1.4 |     94% |           95% | **$0.0051** | 2.7 min  |
| z-ai/glm-5.2                        |              64% (23/36) | 67%/58%/67% |             19% (23/123) |             0.11 |           1.3 |     95% |           93% |     $0.0354 | 0.7 min  |
| minimax/minimax-m3 (incumbent) ‡    |              64% (23/36) | 67%/58%/67% |             19% (23/123) |             0.06 |           1.1 |     95% |           98% |     $0.0177 | 3.1 min  |
| openai/gpt-5.6-luna                 |              53% (19/36) | 50%/50%/58% |             15% (19/123) |             0.22 |           1.6 |     84% |           92% |     $0.0043 | 0.7 min  |
| tencent/hy3                         |              53% (19/36) | 58%/50%/50% |             15% (19/123) |             0.11 |           1.3 |     88% |           94% |     $0.0071 | 1.7 min  |

† 2 sweeps, not 3 — see "mimo truncates". One hard scan failure, charged as a zero day.
‡ one 20-minute timeout on `2026-06-10-jaro-contract-x3`, charged as a zero day.

`tencent/hy3-preview` (the leaderboard entry) is **unusable**: our OpenRouter key's
zero-data-retention policy leaves it with no compliant endpoint — every request
404s with "No endpoints available matching your guardrail restrictions". The GA
`tencent/hy3` is benchmarked in its place at 2× the preview's price. Every other
model on the list passed ZDR routing.

## Golden mismatch — read before quoting the absolute numbers

The fixtures' goldens were relabeled on 2026-07-31 (evals `423da99`) from 12 keep
blocks to 41, widening the scan gate so work-system checks count as tasks. That
relabel was paired with **PR #266, which was closed and never merged**. Main's
scan prompt still targets the narrow gate.

So the eval as it stands scores every model against a policy the shipped prompt
does not implement, which is why widened-gate recall is 15–26% across the board —
that column measures the unshipped target, not model quality. The shipped-gate
column re-scores the same runs against only the 12 blocks that were keeps before
the relabel; it is the number to use for model selection, and it is directly
comparable to the 2026-07-27 baseline (minimax 10/12 on a single sweep).

Either merge #266's widened prompt or revert the goldens — until one of them
happens, `npm run eval-tasks` reports a recall figure no model can reach.

## Failure modes found

1. **mimo truncates on big days.** On the 348-activity fixture, `xiaomi/mimo-v2.5`
   returns exactly 16,384 output tokens with no closing JSON array, three attempts
   in a row, then fails the day (~30 min burned per sweep). Its endpoint pool on
   OpenRouter mixes 16k-completion providers with 1M-capable ones and the miner
   sets no `maxTokens`, so which one you get is a routing lottery. It scans the
   307- and smaller-activity days fine (3.4k–7.3k output). Any model can hit this;
   setting an explicit `maxTokens` on the scan call would force OpenRouter to route
   past the small-cap endpoints.
2. **minimax hits the 20-minute timeout.** One fixture in one sweep died on
   `PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS`. At ~3 min/day mean it is not
   generally slow, but its tail is long enough to lose whole days in production.
3. **Recurrence completeness is the common miss.** `gpt-5.6-luna` and `hy3` missed
   occurrences 2/3 and 3/3 of the repeated contract task in all 6 chances each —
   they emit one sighting for the first occurrence and never enumerate the repeats.
   nex-n2-pro is the only model that consistently gets them, which is most of its
   recall lead. `Remove tenant user (recurring toil ×2)` is missed by every model.

## Cost and latency

$/day is per fixture-day at live OpenRouter list prices. The pricing table in
`src/main/semantic/constants.ts` was stale and is corrected in this change:
glm-5.2 was listed at 0.93/3.00 (actually 0.76/2.42), mimo-v2.5 and
deepseek-v4-flash at 0.105/0.28 and 0.09/0.18 (both now 0.14/0.28). Entries added
for `deepseek-v4-flash-0731`, `tencent/hy3`, `gpt-5.6-luna` and `nex-n2-pro`.

Note the leaderboard screenshot's prices sit below OpenRouter list for three
models (glm-5.2 at 0.28/0.88 vs 0.76/2.42; mimo and minimax at 0.8×). Costs here
use what the app actually pays. glm-5.2 is the most expensive model on the board
at OpenRouter rates and does not earn it.

`gpt-5.6-luna` and `glm-5.2` are far and away the fastest (0.7 min/day vs 2.4–4.2
for the rest), which matters if daily mining latency ever becomes a constraint —
but both are mid-pack or worse on recall.

## Caveats

- 12 keep blocks is a small target: one block is 8pp on a single sweep. Per-sweep
  spreads (deepseek 83/67/83, nex 92/83/92) show the noise floor is roughly one
  block, so the deepseek-vs-nex gap (11pp) is near but above it, and the
  deepseek-vs-minimax gap (14pp) is real.
- Open-world scoring: sightings matching no golden block are reported as `new`,
  not as failures. All models produced ~0 new sightings here, so precision rests on
  reject-reproduction and id-precision.
- mimo has 2 sweeps, not 3 (its third was cut short); treat its 79% as provisional.
- Deterministic scoring only, no LLM judge.
- Raw scorecards: `evals/task-mining/results/2026-08-05T*.{md,json}`.

---

## Prior run — 2026-07-03: one-shot scan vs two-phase

Kept for the mode decision, which still stands. Scored against the older
toil-reseeded goldens (95 keep blocks); recall figures are not comparable to the
table above.

**One-shot scan (no Phase 2 grounding) is the default mode.** Phase 2
tool-grounding _lowered_ recall on every model tried (it rejects real toil and
drops occurrences) while multiplying calls 5–10×. Best model then was
`minimax/minimax-m3` at 84% mean recall vs the shipped config's 26%.

| Model                      | Recall (runs)  | Rejects reproduced | Cost/day   | Notes                                           |
| -------------------------- | -------------- | ------------------ | ---------- | ----------------------------------------------- |
| minimax/minimax-m3         | 84% (87/84/81) | 4–6/32             | $0.04–0.05 | Winner at the time                              |
| xiaomi/mimo-v2.5           | 82% (n=1)      | 1/32               | $0.015     | Value runner-up                                 |
| tencent/hy3-preview        | 78% (83/74/78) | 1–4/32             | $0.006     | Cheapest, but no ZDR endpoints                  |
| z-ai/glm-5.2               | 72% (77/65/75) | ~1/32              | $0.05      | Provider flaky: empty 1–2-token responses       |
| google/gemini-2.5-flash    | 62% (59/66)    | up to 9/32         | $0.026     | Old default; worst reject-reproduction          |
| deepseek/deepseek-v4-flash | 60% (55/65)    | ~2/32              | $0.004     | One zero-parse day (now retried); budget option |

What moved the needle then: the toil-framing prompt rework (~5–13pp on every
model), short served ids (`a1..aN` instead of UUIDs — models mangle 36-char UUIDs
when citing them), scan retry on zero-candidate responses, and dropping Phase 2.

- Mode default: `DEFAULT_MINER_CONFIG` in `src/main/services/task-miner/types.ts`.
- Mode flags: `npm run eval-tasks -- --two-phase`, `npm run mine-tasks -- --two-phase`.
