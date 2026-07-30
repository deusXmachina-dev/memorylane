# Structured Output (json_schema) in Task Mining

Date: 2026-07-27
Model: minimax/minimax-m3 via OpenRouter, scan-only
Harness: `npm run eval-tasks`, 6 committed fixtures, 12 keep-tasks

## Question

The task miner extracts JSON from the model's text with hand-rolled helpers
(`tryExtractJsonArray`, `extractJsonObject`). The AI SDK offers
`generateText({ output: Output.array({ element: zodSchema }) })`, which sends a
`json_schema` response format on the wire and returns a validated object. Is
the custom parsing worth replacing?

## Result: no — constrained decoding costs recall

Three arms, one run each. Arms B and A share identical prompts and code; they
differ only in whether the schema goes on the wire.

| Fixture                            | main (exemplar prompt, custom parse) |           A: schema on wire | B: schema in prompt, local parse |
| ---------------------------------- | -----------------------------------: | --------------------------: | -------------------------------: |
| 2026-06-04-jaro-contract-multitask |                                  1/2 |                         1/2 |                              1/2 |
| 2026-06-10-jaro-contract           |                                  1/1 |                         1/1 |                              1/1 |
| 2026-06-10-jaro-contract-multitask |                                  1/1 |                         1/1 |                              1/1 |
| 2026-06-10-jaro-contract-x3        |                                  3/3 |                         3/3 |                              3/3 |
| 2026-06-10-jaro-contract-x3-llm    |                                  3/3 |                     **1/3** |                              3/3 |
| 2026-06-11-jaro-contract           |                                  1/2 |                     **0/2** |                              1/2 |
| **Recall**                         |                      **10/12 (83%)** |              **7/12 (58%)** |                  **10/12 (83%)** |
| Id-precision                       |                      100% everywhere | 27% and 70% on two fixtures |           100% except 41% on one |
| Junk rejects reproduced            |                                    0 |                           5 |                                1 |
| Cost                               |                               $0.169 |                      $0.083 |                           $0.122 |

Arm B matches main fixture for fixture, which is stronger evidence than the
totals: the prompt rewrite (hand-written exemplar replaced by a rendered JSON
Schema) is not what hurt. Sending `json_schema` is.

The mechanism shows up in output tokens — on `2026-06-10-jaro-contract`, cost
fell from $0.0624 to $0.0113 under constrained decoding. The model stops
deliberating and emits a filled-in shape, so on the two hardest fixtures it
finds nothing at all and elsewhere cites activities it hasn't reasoned about.

## Why the refactor was dropped

The version that doesn't regress (arm B) still needs text extraction — fence
strip, `JSON.parse`, brace-span fallback — so "delete the custom parsing" is
not on offer. What remained was Zod field validation and one schema definition
feeding both prompt and parse, for +385/-293 across 19 files plus 278 new lines
of schemas, with the cluster-review path (`clustering/llm-review.ts`) still
unmeasured because the task-mining eval is scan-only. Not worth it; branch
discarded.

## Also learned

OpenRouter picks an upstream provider per request, and a `json_schema` request
routed to one that doesn't implement it fails the whole call — served as HTTP
200 with a 502 body, surfacing as `Invalid JSON response`. Pinning
`provider: { require_parameters: true }` fixes it. Only relevant if wire
schemas are ever revisited.

Caveat on all of the above: 12 keep-tasks, one run per arm, nondeterministic
model. Treat the direction as real and the exact counts as noisy.
