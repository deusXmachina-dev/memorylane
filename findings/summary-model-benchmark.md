# Activity-Summary Model Benchmark

Sections newest first.

## 2026-10-28 — 17 fixtures, pipeline × model × snapshots

Eval: `npm run eval-summaries -- --vendor openrouter [--pipeline image] [--model <id>] [--max-snapshots N]`, all 17 fixtures (80–81 activities), no LLM judge. Pairwise judgment by claude-opus-5-5 under rubric v1 (`summary-prompt-experiments.md`). OpenRouter spend: $2.73 for the first sweep, $4.28 cumulative after the new-model screen and prompt rewrites.

### Verdict

- **Pipeline is not the lever; the model is.** The same Gemini model scores the same on images and video (3.1 Flash Lite 70.5 vs 70–73 mention; 3 Flash 76.5 vs 76.1). Images win only because `gpt-6-luna` has no video input.
- **`gpt-6-luna` on 6 snapshots beats the video head**: judged B 42 · A 34 · tie 4 of 80, `wrong-action` 10 vs 16, `wrong-detail` 14 vs 21, at +17% cost ($0.083 vs $0.071 per run). Its fault is padding: `over-long` 18 vs 2.
- **`gemma-4-31b-it` on images is the cheap point**: judged B 36 · A 33 · tie 11 vs the video head at 1/5 the cost ($0.013), but more `missed-action` (27 vs 19) and `vague` (8 vs 1). Below the +10% gate.
- **6 snapshots is the knee.** 3 loses about 6 pt mention on both Luna and Gemma; 10 and 16 add cost and nothing measurable.
- GLM 5.3 Flash leads on mention (81–85) but still leaks raw interaction vocabulary (23–27 hard fails). Gemini 3.8 Flash is the ceiling (82.6) at 5× the cost.

### New OpenRouter models (2026-10-28, image unless noted, 1 run each, submit-keys prompt `30d9f85`)

Candidates: cheap (≤ $0.15/M in) ZDR vision models added since September, cross-checked with the Arena vision leaderboard (2026-10-19), whose top 40 is almost all premium models.

| Model                                 | Mention% | Hard fails | Det pass | $/run |
| ------------------------------------- | -------: | ---------: | -------: | ----: |
| gpt-6-luna (incumbent, 2 runs)        |     70.5 |        0.5 |    96.0% | 0.083 |
| claude-haiku-5.5                      |     76.0 |         27 |    93.5% | 0.092 |
| claude-haiku-5.5, P3 timeline wording |     74.8 |         17 |    96.0% | 0.094 |
| minimax-m3.1-flash                    |     73.0 |         25 |    94.3% | 0.132 |
| minimax-m3.1-flash (video)            |     71.7 |         12 |    95.7% | 0.151 |
| gpt-6-luna-pro                        |     70.9 |          0 |    96.7% | 0.209 |
| nemotron-3.5-super-vl                 |     66.8 |          8 |    95.1% | 0.132 |
| deepseek-v4.1-flash                   |     64.7 |         12 |    96.2% | 0.125 |
| perceptron-mk1.5                      |     64.7 |         18 |    90.2% | 0.100 |
| nemotron-3.5-super-vl (video)         |     44.6 |         26 |    92.2% | 0.093 |

- None replaces gpt-6-luna. Haiku 5.5 has the best recall but writes "typed"/"typing" on its own (17 hard fails even with neutral timeline wording) and runs ~50% longer.
- Luna Pro = Luna quality at 2.5× cost.

### Judged pairs (overall row, 17 shared fixtures, 2 runs per arm)

| A vs B                                    | Mention% A / B | Hard fails A / B | Det pass A / B |       $/run A / B | Wins A · B · tie |
| ----------------------------------------- | -------------: | ---------------: | -------------: | ----------------: | ---------------: |
| video 3.1-flash-lite vs image gpt-6-luna  |      68% / 70% |        2.0 / 1.5 |      93% / 96% | $0.0710 / $0.0830 |      34 · 42 · 4 |
| video 3.1-flash-lite vs image gemma-4-31b |      68% / 63% |        2.0 / 2.0 |      93% / 89% | $0.0710 / $0.0132 |     33 · 36 · 11 |

Judgment files: `compare-2026-10-28T09-30-36-179Z-baseline-video-5356aac-vs-2026-10-28T09-30-13-385Z-baseline-image-5356aac.judgment.md`, `compare-2026-10-28T09-30-36-179Z-baseline-video-5356aac-vs-2026-10-28T09-37-27-284Z-screen-image-gemma-4-31b-it.judgment.md`.

### Screen (1 run each, scored on the 62 activities every run completed)

Phase 1 ran 11 evals in parallel; the load caused `fetch failed` and 120 s timeouts on the same large activities in every run, so each run is scored only on the activities all runs completed.

| Pipeline | Model                        | Mention% | Hard fails | Det pass |  $/run |
| -------- | ---------------------------- | -------: | ---------: | -------: | -----: |
| video    | gemini-3.1-flash-lite (head) |    70–73 |          1 |      93% | 0.0710 |
| image    | gpt-6-luna (snapshot head)   |    76–77 |          1 |      96% | 0.0830 |
| image    | gemma-4-31b-it               |       70 |          1 |      90% | 0.0131 |
| image    | gemini-3.1-flash-lite        |       71 |          3 |      92% | 0.0870 |
| image    | gemini-3-flash-preview       |       77 |          2 |      98% | 0.1800 |
| video    | gemini-3-flash-preview       |       76 |          1 |      97% | 0.1249 |
| image    | gemini-3.5-flash-lite        |       67 |          2 |      89% | 0.1061 |
| video    | gemini-3.5-flash-lite        |       65 |          2 |      88% | 0.0724 |
| image    | glm-5.3-flash                |       81 |         27 |      93% | 0.1444 |
| video    | glm-5.3-flash                |       85 |         23 |      93% | 0.3621 |
| video    | gemini-3.8-flash (ceiling)   |       83 |          4 |      97% | 0.3447 |
| image    | mimo-v2.6-flash              |       78 |         13 |      92% | 0.0781 |
| image    | qwen3.5-9b                   |       68 |         15 |      93% | 0.0597 |

### Snapshot cap (image, 1 run each, 79 common activities)

| Model          |    3 |         6 |   10 |   16 | $/run at 3 → 16 |
| -------------- | ---: | --------: | ---: | ---: | --------------: |
| gpt-6-luna     | 64.5 | 70.4–70.8 | 66.9 | 70.6 |   0.069 → 0.098 |
| gemma-4-31b-it | 62.1 |      66.8 | 64.7 | 65.7 |   0.012 → 0.015 |

## 2026-10-06 — 3 fixtures

Eval: `npm run eval-summaries -- --pipeline <image|video> --model <id> --judge-model moonshotai/kimi-k3`,
all 3 fixtures (20 activities), 2 sweeps per model, one process per model. ZDR-only OpenRouter key.
Equiv = judge equivalence to golden (noise ±0.03). Hard fails = deterministic hard-check failures per sweep
(mostly `noRawInteractionVocab`; `emptySummary` counted separately). $ = summarizer spend per sweep.

### Verdict

- **Image fallback: `mistral-small-3.2` → `gpt-6-luna` → `gemma-4-31b-it` → `gemini-3.5-flash-lite`.**
  Mistral was the worst model on the board (0.70 equiv, 5 empty summaries from provider errors).
  gpt-6-luna leads on quality with almost no hard fails; gemma-4-31b matches gemini-3.5-flash-lite
  at 1/9 the cost with zero hard fails.
- **Video: head unchanged (`gemini-3.1-flash-lite`).** Cheapest model with 0 hard fails. `glm-5.3-flash`
  replaces `gemini-3.5-flash` (the most expensive) as the first non-Google fallback, so a Google outage
  no longer drops every activity to the image path.
- **Video bug fixed.** The raw video request sent `type: "input_video"`, which only Gemini accepts. Every
  other OpenRouter model returned 400/422, so no non-Gemini model could ever serve the video lane. It now
  sends OpenRouter's documented `video_url` part. Gemini scores are unchanged by the switch.

### Image (snapshot) pipeline

| Model                                      | Equiv | Det pass | Hard fails | Empty | $/sweep |
| ------------------------------------------ | ----: | -------: | ---------: | ----: | ------: |
| `z-ai/glm-5.3-flash`                       |  0.84 |      96% |        6.5 |     0 | $0.0329 |
| **`openai/gpt-6-luna`**                    |  0.83 |      98% |        0.5 |     0 | $0.0184 |
| `xiaomi/mimo-v2.6-flash`                   |  0.81 |      93% |        3.5 |     1 | $0.0187 |
| `qwen/qwen3.5-9b`                          |  0.80 |      96% |        4.0 |     0 | $0.0134 |
| `google/gemini-3.5-flash-lite` (incumbent) |  0.80 |      88% |        2.0 |     0 | $0.0252 |
| `inclusionai/ling-3.0-flash-vl`            |  0.78 |      89% |        3.5 |     2 | $0.0036 |
| **`google/gemma-4-31b-it`**                |  0.78 |      90% |        0.0 |     0 | $0.0029 |
| `google/gemma-4-26b-a4b-it`                |  0.77 |      96% |        1.0 |     0 | $0.0029 |
| `mistralai/mistral-small-3.2` (incumbent)  |  0.70 |      74% |        4.0 |     5 | $0.0088 |
| `mistralai/mistral-small-2603`             |  0.64 |      68% |        4.0 |     7 | $0.0152 |

glm-5.3-flash ties for best equivalence but leaks raw interaction vocabulary ("clicked", "scrolled") on
every sweep. Both Mistral models fail intermittently with "Provider returned error"; image count is not
the trigger (12-image requests succeed).

### Video pipeline

| Model                                       | Equiv | Det pass | Hard fails | Empty | $/sweep |
| ------------------------------------------- | ----: | -------: | ---------: | ----: | ------: |
| `z-ai/glm-5.3-flash`                        |  0.89 |      96% |        3.5 |     0 | $0.0741 |
| `google/gemini-3.8-flash` (ceiling only)    |  0.88 |      98% |        0.5 |     0 | $0.0661 |
| `google/gemini-3-flash-preview` (incumbent) |  0.88 |      98% |        2.5 |     0 | $0.0259 |
| `qwen/qwen3.8-27b`                          |  0.85 |      98% |        2.0 |     0 | $0.1218 |
| `google/gemini-3.1-flash-lite` (incumbent)  |  0.81 |      90% |        0.0 |     0 | $0.0126 |
| `qwen/qwen3.6-35b-a3b`                      |  0.80 |      93% |        4.5 |     0 | $0.0360 |
| `google/gemma-4-26b-a4b-it`                 |  0.75 |      93% |        1.0 |     0 | $0.0050 |
| `google/gemma-4-31b-it`                     |  0.75 |      90% |        0.0 |     0 | $0.0049 |
| `inclusionai/ling-3.0-flash-vl`             |  0.71 |      91% |        2.5 |     1 | $0.0026 |
| `qwen/qwen3.5-9b`                           |  0.64 |      75% |       10.0 |     4 | $0.0070 |
| `xiaomi/mimo-v2.6-flash`                    |  0.60 |      56% |        9.5 |    13 | $0.0197 |

Non-Gemini video costs 3–10× more per activity: they tokenize video frame-by-frame (see
`video-token-benchmark.md`), so glm's quality lead does not justify the head slot. `gpt-6-luna` has no
video input. Not tested (no ZDR endpoint): qwen3.7/3.8-flash, meta muse-spark.

### Gemini retirements

Google discontinues Gemini 3.6 Flash on 2026-11-19 and 3.7 Flash on 2027-01-28. Neither is in any chain;
the 3.6 entry in the pricing table is benchmark-only.

### Caveats

- 20 activities, 2 sweeps: differences under ~0.03 equiv are noise.
- Raw scorecards: `evals/semantic-summary/results/2026-10-06T*`. Video runs before the `video_url` fix
  were discarded.
