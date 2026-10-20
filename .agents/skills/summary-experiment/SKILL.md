---
name: summary-experiment
description: Run a repeatable activity-summary experiment against the semantic-summary eval fixtures - a prompt change, new metadata fed to the summarizer, or a new model - compare it to a baseline, judge every activity pairwise, review with the user, and log the verdict in findings. Use when asked to tune the summary prompt, feed something new to the summarizer, check whether a model beats the incumbent, or score summary eval runs.
---

# Summary Experiment

One hypothesis in, one logged verdict out. The thing you test is the thing you ship: a prompt variant is an edit to `src/main/semantic/prompt.ts` on a branch, never a registry. The eval records git sha, label and the exact prompt per activity; `compare-summaries` diffs any two runs; you judge; the user overrules.

Two modes:

- **Mode A, prompt or metadata.** Edit `prompt.ts` (and `describeInteraction`, `activity-transformer.ts` when new inputs are threaded). Baseline = `main`'s prompt, same model.
- **Mode B, model release.** No prompt edit. Baseline = the incumbent model on the same prompt. Add the candidate to `MODEL_PRICING_USD_PER_MILLION` in `src/main/semantic/constants.ts` first or cost shows `—`, and smoke-test one video and one image request before a full run.

The user may hand you run ids and ask only for scoring. Then start at step 6.

## Prerequisites

- Repo root as cwd. Fixture paths, result paths and the recorded git sha all resolve against the cwd; from `evals/` you would record the nested evals repo's sha.
- `OPENROUTER_API_KEY` in the repo-root `.env`; the prod `capture-settings.json` supplies vendor and default models.
- `evals/` is a separate git repo (`memorylane-evals`), ignored by the main repo. Fixtures and results are committed there, code here.
- `src/main/semantic` and `src/shared` clean before a baseline run. A dirty tree is stamped `(dirty)` in every report header and a baseline must not carry it.

## Constants

- No `--judge`. Scoring is the free checks (segmentation, deterministic rules, must-mention) plus your pairwise judgment under the rubric below.
- All 12 fixtures unless the hypothesis names a subset. A subset run never ships a change.
- Two runs per arm. One process per run, in parallel, under `caffeinate -i`.
- `--pipeline video` (the default). Add an `image` pair only when the change touches shared prompt text and is going to ship.
- Prompt arms are always separate runs. `--models a,b` in one run cannot be compared by prompt.

## Steps

### 1. Frame the hypothesis

Before any spend, write one failure mode: which fixtures and activities show it (cite rows from the latest worksheet or judgment file in `evals/semantic-summary/results/`), what change should move it, and which metric. Append a dated entry at the top of `findings/summary-prompt-experiments.md`:

```markdown
## 2026-10-21 — <slug>

**Hypothesis:** …
**Change:** …
**Baseline:** <run ids> · **Candidate:** <run ids> · **Judgment:** <file>
**Result:** (table)
**Verdict:** …
```

Fill Hypothesis and Change now, the rest at step 9.

### 2. Branch

```bash
git fetch origin && git checkout -b feat/<slug> origin/main
```

Never branch off the checked-out feature branch. One PR per effort; follow-ups go to the same branch.

### 3. Baseline

Reuse an existing run pair whose header shows the same git sha for `src/main/semantic`, the same pipeline and no `(dirty)`. Otherwise, with the prompt still unchanged:

```bash
caffeinate -i npm run eval-summaries -- --label baseline-$(git rev-parse --short HEAD) &
caffeinate -i npm run eval-summaries -- --label baseline-$(git rev-parse --short HEAD) &
wait
```

Mode B: add `--model <incumbent>`.

### 4. Show the prompt before spending

Make the change, then run one fixture and read what was sent:

```bash
npm run eval-summaries -- --fixture petr-test-tenant-2026-10-16-11-32-08 --label probe-<slug>
```

Open `prompts.md` in the new run dir and show the user one activity's rendered prompt next to the baseline's. Stop here if the rendering is not what the hypothesis intended.

### 5. Candidate runs

```bash
caffeinate -i npm run eval-summaries -- --label <slug> &
caffeinate -i npm run eval-summaries -- --label <slug> &
wait
```

Mode B: `--model <candidate>`.

### 6. Compare

```bash
npm run compare-summaries -- --a <baseline1>,<baseline2> --b <candidate1>,<candidate2>
```

Writes `evals/semantic-summary/results/compare-<A>-vs-<B>.md`: per-arm provenance, a per-run metrics table over the shared fixtures, a Review-first list (must-mention flips, hard-fail changes), and the worksheet with golden, every A run and every B run per activity.

### 7. Judge

Read the worksheet in one pass, fixture by fixture, and write `compare-<A>-vs-<B>.judgment.md` next to it. Over about 60 activities, fork one agent per fixture with the rubric text verbatim and tally in the main session.

```markdown
# Judgment — compare-<A>-vs-<B>

Judge: <model>, <date> · rubric v1

| Fixture  |   # | Verdict | A faults     | B faults | Why                                           |
| -------- | --: | ------- | ------------ | -------- | --------------------------------------------- |
| lead-gen |   9 | B       | wrong-detail | —        | A read "Correction Requests", B names the row |

Tally: B 14 · A 5 · tie 36 of 55. wrong-action A 3 / B 1 · missed-action A 9 / B 4 · wrong-detail A 6 / B 7 · vague A 11 / B 5 · over-long A 0 / B 2
```

**Rubric v1.** Do not edit between experiments; a change bumps the version in every later header.

- Fault tags per summary, judged against the golden only:
  - `wrong-action`: claims something that did not happen or the wrong end-state ("sent" when the golden says left unfinished).
  - `missed-action`: the golden's main action is absent.
  - `wrong-detail`: a misread cell, number, name, file or ticket.
  - `vague`: none of the specifics the golden has.
  - `over-long`: padding beyond the golden's substance.
  - Raw interaction vocabulary and meta-openers come from the deterministic checks; do not re-tag them.
- Verdict per activity: fewer `wrong-action` wins; then fewer `missed-action`; then more correct specifics; then shorter. Equal is a tie.
- With two runs per arm, judge the arm by its worse run. A flaky regression is not averaged away.
- Judge both arms in the same pass. Never score a fresh candidate against a judgment written in an earlier session.

Then report to the user: the shared-fixture metrics row, the tally, and every row where B lost or either arm has a `wrong-action`, each with golden, A and B text. Edit their overrides into the judgment file and recompute the tally.

### 8. Verdict

Ship when all hold:

- B's net wins (B − A) ≥ 10% of judged activities.
- B's `wrong-action` count ≤ A's.
- Hard fails not up, must-mention not down (shared-fixture metrics row).
- The user signed off on the reported rows.

Mode B adds: cost per run ≤ incumbent, or clearly better on the above.

Otherwise revert the prompt and keep the entry: a negative result is a result.

### 9. Log

Fill the findings entry: run ids, judgment file, the tally, the shared-fixture metrics (Mention% / Hard fails / Det pass% / Cost, A vs B vs Δ, per pipeline), the verdict and the failure modes seen. Numbers are copied from the compare and judgment files, never retyped from memory. No verbatim summaries or golden text in the main repo.

### 10. Ship

Mode A: keep the prompt edit; update `src/main/eval/deterministic.ts` and `src/main/semantic/prompt.test.ts` if a rule changed.

Mode B: update the `semanticVideo` / `semanticSnapshot` presets in `src/shared/vendor-defaults.ts` and bump `MODEL_DEFAULTS_VERSION`; mirror in the enterprise and private backend `model_config`.

Both:

```bash
cd evals && git add semantic-summary/results/<run dirs> semantic-summary/results/compare-* && git commit -m "results: <slug>"
```

Then the main-repo PR with the findings entry and the code.

## Checklist

- [ ] Hypothesis written before the first run
- [ ] Baseline header clean, same sha as `main` for `src/main/semantic`
- [ ] Prompt rendering shown to the user before the full candidate runs
- [ ] Two runs per arm, all fixtures
- [ ] Judgment file written, user's overrides merged, tally recomputed
- [ ] Findings entry has numbers copied from the files
- [ ] Results committed in `evals/`, code and findings in the main repo
