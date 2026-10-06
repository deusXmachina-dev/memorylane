# Activity-Summary Model Benchmark

Date: 2026-10-06. Eval: `npm run eval-summaries -- --pipeline <image|video> --model <id> --judge-model moonshotai/kimi-k3`,
all 3 fixtures (20 activities), 2 sweeps per model, one process per model. ZDR-only OpenRouter key.
Equiv = judge equivalence to golden (noise ±0.03). Hard fails = deterministic hard-check failures per sweep
(mostly `noRawInteractionVocab`; `emptySummary` counted separately). $ = summarizer spend per sweep.

## Verdict

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

## Image (snapshot) pipeline

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

## Video pipeline

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

## Gemini retirements

Google discontinues Gemini 3.6 Flash on 2026-11-19 and 3.7 Flash on 2027-01-28. Neither is in any chain;
the 3.6 entry in the pricing table is benchmark-only.

## Caveats

- 20 activities, 2 sweeps: differences under ~0.03 equiv are noise.
- Raw scorecards: `evals/semantic-summary/results/2026-10-06T*`. Video runs before the `video_url` fix
  were discarded.
