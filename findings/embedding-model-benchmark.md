# Local embedding model benchmark (DEU-277)

2026-10-29. Script: `scripts/bench-embeddings.ts`. Data, cache and raw results: `evals/embedding-bench/` (gitignored evals repo; final run `results/2026-10-29T15-23-57-793Z.md`).

## Setup

- **Data**: snapshot of one prod DB (54.8k activities). Summaries are English but often quote Czech; ~23% of OCR text is Czech.
- **Queries**: 298 target activities, stratified by app: 1/3 summary-embedded with Czech on screen, 1/3 summary-embedded without, 1/3 OCR-embedded passive views. `gemini-3.1-flash-lite` wrote one EN and one CS query per target (paraphrased; for summary targets it saw only the summary) → 596 queries.
- **Relevant** = target + same app/window title within ±10 min.
- **Corpus**: targets + 10k random activities. Brute-force cosine (= sqlite-vec KNN). Texts capped at 512 tokens.
- **Speed**: Apple Silicon, 4 threads (ml-worker cap), transformers.js 4.3.1, batch 16.
- **Clustering**: sighting-pair separation on 950 titles from task-mining eval runs, grouped by golden task (title only; 53 groups), and on the 40 sightings in 6 labeled prod clusters (title + description).
- Bench pooling reproduces the app's stored MiniLM vectors (median cosine 1.000).

## Search

Embedded text = what the app embeds today (`summary || ocrText`). MRR@10.

| Model | Dim | Bundle | ms/doc | Vector | All | EN query | CS query | OCR-embedded | R@10 |
|---|---|---|---|---|---|---|---|---|---|
| FTS5, all words (today's FTS) | — | — | — | — | 0.078 | 0.150 | 0.007 | 0.032 | 0.09 |
| FTS5, any word | — | — | — | — | 0.275 | 0.409 | 0.140 | 0.188 | 0.43 |
| MiniLM-L6 fp32 (today) | 384 | 91 MB | 8.3 | 1.5 KB | 0.277 | 0.416 | 0.139 | 0.096 | 0.42 |
| MiniLM-L6 q8 | 384 | 24 MB | 3.6 | 1.5 KB | 0.272 | 0.414 | 0.131 | 0.092 | 0.41 |
| multilingual-e5-small q8 | 384 | 135 MB | 8.4 | 1.5 KB | 0.337 | 0.457 | 0.217 | 0.156 | 0.49 |
| granite-embedding-97m-multilingual-r2 q8 | 384 | 123 MB | 9.5 | 1.5 KB | 0.368 | 0.420 | 0.316 | 0.167 | 0.53 |
| granite-embedding-311m-multilingual-r2 q8 | 768 | 346 MB | 31.7 | 3 KB | 0.451 | 0.494 | 0.408 | 0.220 | 0.64 |
| ↳ truncated | 384 | | | 1.5 KB | 0.441 | 0.480 | 0.402 | 0.219 | 0.63 |
| harrier-oss-v1-270m q8 | 640 | 364 MB | 74 | 2.5 KB | 0.367 | 0.421 | 0.314 | 0.081 | 0.53 |
| embeddinggemma-2 q8 (2.3 GB peak RSS) | 768 | 346 MB | 118 | 3 KB | 0.478 | 0.493 | 0.462 | 0.218 | 0.70 |

Bundle = q8 (or fp32) ONNX + `tokenizer.json`.

### Hybrid ranking

- **Today's hybrid is vector-only.** `search_context` takes `limit` vector hits, appends FTS extras, truncates to `limit` → FTS never shows. Scores are identical to vector-only for every model.
- **RRF (k=60) of vector + any-word FTS** helps weak models, slightly costs strong ones:

| Model | Vector | RRF + any-word FTS | R@10 vector → RRF |
|---|---|---|---|
| MiniLM-L6 fp32 | 0.277 | 0.336 | 0.42 → 0.50 |
| e5-small | 0.337 | 0.389 | 0.49 → 0.57 |
| granite-97m | 0.368 | **0.409** | 0.53 → **0.60** |
| granite-311m | 0.451 | 0.432 | 0.64 → 0.66 |
| embeddinggemma-2 | 0.478 | 0.450 | 0.70 → 0.67 |

A stronger FTS leg doesn't change this. `bm25(fts, 1.0, 0.4)` (summary over OCR) lifts any-word FTS alone to 0.299 / R@10 0.48, but RRF with it gives granite-97m 0.405, granite-311m 0.431, Gemma 0.462. Fusion lifts EN queries (Gemma 0.493 → 0.537) and drags CS queries (0.462 → 0.386): Czech queries rarely match the English summaries lexically, so the FTS list is noise for them.

### Embedded text

Prefixing app + window title (`context`) is not a general win: +0.02 for Harrier, ±0 for MiniLM/Granite-311m/Gemma, −0.03 for e5/Granite-97m. It helps OCR-embedded rows for Gemma (0.22 → 0.31). Keep today's text.

## Clustering

| Model | AUC eval / prod | Best threshold | F1 @0.65 (prod) |
|---|---|---|---|
| MiniLM-L6 fp32 | 0.941 / 0.988 | 0.58 | 0.82 |
| e5-small | 0.928 / 0.993 | 0.90 | 0.34 |
| granite-97m | 0.934 / 0.992 | 0.85 | 0.34 |
| granite-311m | 0.938 / 0.990 | 0.89 | 0.34 |
| harrier-270m | 0.930 / 0.996 | 0.87 | 0.34 |
| embeddinggemma-2 | 0.934 / 0.991 | 0.89 | 0.34 |

- No model separates tasks better than MiniLM. Best F1 on the eval set is ~0.40 for all models (golden groups overlap across fixtures, so labels are noisy).
- `SIMILARITY_THRESHOLD = 0.65` is MiniLM-specific. Multilingual models put unrelated sightings at 0.72–0.87, so at 0.65 everything merges. A swap must retune it (granite-97m: ~0.85) and recompute stored signatures and centroids.

## Recommendation

1. **Fix the hybrid (free):** RRF of vector + any-word FTS in `search_context`. MiniLM 0.277 → 0.336.
2. **Swap to granite-embedding-97m-multilingual-r2 q8:** +32 MB installer, same speed, same 384-dim schema. With RRF: 0.409 MRR, 0.60 R@10, Czech queries 2.3× today.
3. Rejected for the desktop: granite-311m / embeddinggemma-2 / harrier (+255–273 MB installer; Gemma also 118 ms/doc and 2.3 GB RSS). Fine server-side.
4. **Keep embeddings.** Any-word FTS alone matches today's MiniLM, but granite-97m + RRF beats it by 49%.

A swap needs: re-embed `activities_vec` and sighting signatures in the ml-worker backlog (54k × ~10 ms ≈ 9 min), clustering threshold ~0.85, and a recorded model id so mixed-model vectors are never compared.

OCR-embedded passive views stay weak for every model (MRR ≤ 0.31): screen text is noisy and includes background windows. Separate problem.
