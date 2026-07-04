# Task-Mining Benchmark — one-shot scan vs two-phase, model sweep

Date: 2026-07-03
Eval: `npm run eval-tasks` over the 6 committed fixtures (`evals/task-mining/fixtures/`),
toil-reseeded goldens (95 keep blocks, 32 reject blocks total). Recall = keep blocks
reproduced (≥50% of a block's activity ids in one sighting). Priority: false negatives
worse than false positives.

## Verdict

**One-shot scan (no Phase 2 grounding) is the new default mode.** Phase 2
tool-grounding _lowered_ recall on every model tried (it rejects real toil and
drops occurrences) while multiplying calls 5–10×. Best model: `minimax/minimax-m3`
at 84% mean recall and ~$0.04/day vs the shipped config's 26% at ~$0.13/day — 3.2×
the recall at a third of the cost. The model is not hardcoded; the miner follows
the shared default / user-set `patternDetectionModel`, so minimax-m3 is the
recommendation to set there.

## Scorecard (final prompt + short ids + scan retry, scan-only)

Mean over full 6-fixture runs; repeats where noted.

| Model                      | Recall (runs)       | Rejects reproduced | Cost/day   | Notes                                                                                                  |
| -------------------------- | ------------------- | ------------------ | ---------- | ------------------------------------------------------------------------------------------------------ |
| **minimax/minimax-m3**     | **84%** (87/84/81†) | 4–6/32             | $0.04–0.05 | Winner. No hard failures in 3 runs, ZDR endpoints exist                                                |
| xiaomi/mimo-v2.5           | 82% (n=1)           | 1/32               | $0.015     | Value runner-up; fewest false positives                                                                |
| tencent/hy3-preview        | 78% (83/74/78)      | 1–4/32             | $0.006     | Cheapest by far, BUT **no ZDR endpoints** on OpenRouter — fails under a zero-data-retention key policy |
| z-ai/glm-5.2               | 72% (77/65/75)      | ~1/32              | $0.05      | Provider flaky: empty 1–2-token responses that survive retries                                         |
| google/gemini-2.5-flash    | 62% (59/66)         | up to 9/32         | $0.026     | Old default; worst reject-reproduction                                                                 |
| deepseek/deepseek-v4-flash | 60% (55/65)         | ~2/32              | $0.004     | One zero-parse day (now retried); budget option                                                        |

† third run lost 2 fixtures to the OpenRouter key's weekly spend limit; 81% is over the 4 that completed.

Two-phase (same prompts): hy3 64% @ $0.042/day (vs 78% @ $0.006 scan-only);
glm-5.2 partial run no better than scan-only at 6–10× the cost.
Shipped baseline (old prompt, two-phase, gemini-2.5-flash): 26% @ $0.125/day.

## What moved the needle

1. **Prompt rework (toil framing)** — the old scan prompt hunted discrete multi-step
   task instances and said "be selective", so it structurally missed recurring
   micro-toil (the ×24 usage-check golden needs ONE finding bundling all
   occurrences to score). New prompt: repetition + low cognitive load is the signal,
   same micro-action across the day = one finding with every occurrence id,
   single-activity findings encouraged, "final pass" over uncited activities,
   err toward including. Worth ~5–13pp recall on every model.
2. **Short served ids** (`a1..aN` instead of UUIDs in the scan payload,
   `run-detection.ts`) — models mangle 36-char UUIDs when citing them; glm,
   minimax and deepseek each lost entire days to 0-resolvable-id output. Also cuts
   scan input ~20–30%. Prod wins too (real activities are UUIDs).
3. **Scan retry** (3 attempts when a response parses to zero candidates) —
   a malformed response otherwise silently loses the whole day, the worst
   false-negative mode of a one-shot pipeline.
4. **Dropping Phase 2** — grounding calls rejected genuine recurring toil
   ("just checking a page") and trimmed occurrence ids below the 50% match
   threshold. All its value is replaced by the deterministic id→window computation
   that was already downstream.

## Residual misses (all models)

The 1–2-activity micro-blocks: `Install git integration (×2)`, `Triage linear
inbox (×2)`, `Assign linear issue`, `Start capture`, `Merge branch cleanup`.
These sit at the measurement floor (1–2 short activities among ~300 noise rows).
Next lever is probably serializing per-activity duration/interaction hints, not
more prompt surgery.

## Caveats

- Fixture OCR fingerprint (planted task rows have empty `ocrText`) makes the
  planted-task numbers slightly optimistic; the toil keep blocks are real
  dev-day activities and unaffected.
- Recall is measured against labeled keeps only (open-world scorer); "new"
  sightings are triage candidates, not failures. Spot-checks of new sightings
  showed mostly real toil (GCP billing checks, Gmail archiving) plus occasional
  ambient browsing — acceptable given FN > FP priority.
- glm-5.2 judge/equivalence scoring not used; all scoring deterministic.
- Runs on 2026-07-03 hit the default OpenRouter key's weekly spend limit near
  the end of the sweep; affected runs are marked above and were excluded or
  partial-scored.

## Where things live

- Mode default: `DEFAULT_MINER_CONFIG` in `src/main/services/task-miner/types.ts`.
  The model follows the shared `PATTERN_DETECTION_CONFIG.MODEL` / user-set
  `patternDetectionModel`.
- Mode flags: `npm run eval-tasks -- --two-phase`, `npm run mine-tasks -- --two-phase`
  (one-shot is the default for both).
- Raw scorecards: `evals/task-mining/results/2026-07-03T*.{md,json}`.
