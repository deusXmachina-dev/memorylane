# Activity-Summary Prompt Experiments

Running log, newest first. Each entry is one hypothesis scored with `/summary-experiment`:
two baseline runs vs two candidate runs on the semantic-summary fixtures, free checks from
`eval-summaries`, pairwise judgment per rubric v1, user review. Raw runs, compare files and
judgment files live in the evals repo under `evals/semantic-summary/results/`. Model
sweeps are in `summary-model-benchmark.md`.

## 2026-10-21 — enriched-timeline

**Hypothesis:** The interaction timeline is the only non-visual evidence the summarizer gets, and it is lossy (`typing session (N keys)`, `mouse click`) while the rules forbid mentioning key counts. Rendering the already-captured `keySequence` / `clickSequence` classes (typed, Enter, paste, delete, save; click, double-click, right-click) and the page URL should raise must-mention recall on edit-heavy activities (lead-gen sheet cells, failed-invoice form, categorise-batch) and reduce wrong end-states, without touching the rules.

**Change:** `src/main/semantic/prompt.ts` — `describeInteraction` renders key and click classes instead of counts; `app_change` lines and the Context block carry the URL path.

**Baseline:** pending · **Candidate:** pending · **Judgment:** pending

**Result:** pending

**Verdict:** pending
