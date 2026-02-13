# Extraction Update Plan

Replace the Swift OCR subprocess with a two-pass LLM pipeline: **extraction** (image → detailed markdown) then **summarization** (markdown → 5-15 word summary). The database schema and downstream consumers stay unchanged.

## Current Pipeline

```
Screenshot PNG
  → OCR (Swift/Vision subprocess) → raw text
  → Classify (LLM + images) → 5-15 word summary
  → Embed (summary || ocrText) → 384-dim vector
  → Store (text, summary, vector, appName) → SQLite
  → Delete PNG
```

## New Pipeline

```
Screenshot PNG(s)
  → Pass 1: Extract (LLM + images) → detailed markdown (replaces OCR text)
  → Pass 2: Summarize (LLM + text only) → 5-15 word summary
  → Embed (summary || detailedText) → 384-dim vector
  → Store (text, summary, vector, appName) → SQLite
  → Delete PNG
```

## What Changes

### 1. Stop calling OCR

**File:** `src/main/processor/index.ts`

- Remove `import { extractText } from './ocr'`
- Remove the `extractText(filepath)` call on line 114
- The OCR module (`ocr.ts`, `swift/ocr.swift`) stays in the repo untouched for now

### 2. New extraction method in `SemanticClassifierService`

**File:** `src/main/processor/semantic-classifier.ts`

Add a new public method `extract()` that takes the same `ClassificationInput` and returns detailed markdown. This method:

- Receives 1 or 2 screenshot images (same START/END pattern as today)
- Sends them to the vision model with the **extraction prompt** (see below)
- Returns a markdown string (stored as `text` in the DB)

The existing `classify()` method becomes **pass 2**. It changes from vision-based to text-only:

- No longer receives images
- Receives the detailed markdown from pass 1 instead
- Uses a text-only prompt to produce the 5-15 word summary
- No longer needs `imageToBase64` calls

### 3. Update `processScreenshotInternal` orchestration

**File:** `src/main/processor/index.ts`

Current flow per START/END pair:

```
OCR(start) → store ocrText → ... → classify(start_img, end_img) → summary
```

New flow:

```
extract(start_img, end_img) → detailedText → summarize(detailedText) → summary
```

Concretely:

- When a screenshot arrives and there is no START yet → save it as START (no processing yet, same as today but without OCR)
- When END arrives (same app) → call `extract(start, end)` → get detailedText → call `summarize(detailedText)` → get summary → `storeAndCleanup(start, detailedText, summary, events)`
- When END arrives (app changed) → call `extract(start, undefined)` → detailedText → `summarize(detailedText)` → `storeAndCleanup(...)`
- `startOcrText` field → rename to `startDetailedText` (or remove, since extraction now runs at pair-completion time, not per-screenshot)

### 4. Update `storeAndCleanup`

The `ocrText` parameter now carries the detailed markdown from extraction. No signature change needed — just the semantics of what's in `text` change. The embedding input priority (`summary || ocrText`) stays the same.

## What Stays the Same

- Database schema: `context_events` table columns unchanged
- `StoredEvent` interface: same fields
- FTS index: still indexes `text` and `summary` — actually improves since `text` is now richer markdown
- Vector embeddings: still 384-dim from `all-MiniLM-L6-v2`
- START/END pair state machine logic
- Event aggregation and app-change detection
- Queue and concurrency management
- Debug pipeline writer
- MCP server and search APIs

## Extraction Prompt Design (Pass 1)

### Two-image prompt (normal flow)

```
You are a screen content extractor. You are given two screenshots of a user's screen:
the FIRST image is the START state and the SECOND image is the END state.

## Task

Extract the full visible content from BOTH screenshots with OCR-like completeness.
Output structured Markdown that captures every meaningful element on the screen.

## Output format

### START Screenshot

#### App & Window
- Application name, window title, URL (if browser)

#### Navigation / Tabs
- Sidebar items, tab bar contents, breadcrumbs

#### Main Content
- Full text of documents, code, emails, chat messages, articles
- Table data (as markdown tables)
- Form fields and their values
- Terminal output

#### UI State
- Selected items, active tabs, cursor position
- Notifications, popups, tooltips
- Status bar content

### END Screenshot

(Same structure as above)

### Changes
- What appeared, disappeared, or changed between START and END
- Specific diffs: lines added/removed, fields filled, navigation changes

### Activity Summary
One paragraph describing what the user likely did between the two screenshots,
based on the visible changes and any event hints provided.

## Privacy rules

Replace ALL of the following with [REDACTED]:
- Email addresses, phone numbers, physical addresses
- Names of people (except public figures in news articles)
- Account numbers, credit card numbers, SSNs
- API keys, tokens, passwords, secrets
- Personal messages content (keep structure: "chat message from [REDACTED]")
- Financial amounts tied to personal accounts

Keep: application names, file names, code symbols, UI labels, generic content.

## Event hints

{formatted_events}

## Instructions

- Be exhaustive: extract ALL visible text, not just highlights
- Preserve structure: use headers, lists, code blocks, tables
- Mark unclear/truncated text with [...]
- Do NOT infer or fabricate content not visible on screen
- Output ONLY the markdown, no preamble
```

### Single-image prompt (app change)

Same structure but with only one `### Screenshot` section, no `### Changes` section, and the activity summary describes what the user was doing in this app before switching away.

## Summarization Prompt Design (Pass 2)

This replaces the current `classify()` prompt. No images — text only.

```
You are summarizing a user's screen activity.

Below is a detailed extraction of what was visible on the user's screen:

---
{detailed_text}
---

## Event hints

{formatted_events}

## Previous context (for continuity)

{summary_history}

## Instructions

Based on the extraction above, produce a 5-15 word summary of what the user
accomplished or was doing. Be specific: include file names, document titles,
UI elements, data labels.

- STRICT: Response must be ONLY 5-15 words. No explanations or analysis.

Examples:
- "Implemented parseUserInput function in utils.ts"
- "Filled in Q2 revenue numbers for Marketing department"
- "Reviewed PR #142 comments on authentication refactor"
- "Replied to email from [REDACTED] about project deadline"
```

## Cost Impact

- **Before:** 1 LLM call per pair (vision, ~few hundred output tokens) + 1 Swift subprocess
- **After:** 2 LLM calls per pair (vision extraction with ~1-3k output tokens + text-only summary with ~20 output tokens), no subprocess
- Net: higher token usage per pair, but extraction quality much higher, no native dependency, and `text` column becomes genuinely useful for FTS

## Files to Modify

| File                                        | Change                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/main/processor/index.ts`               | Remove OCR import/call, wire extract→summarize two-pass flow, rename `startOcrText`         |
| `src/main/processor/semantic-classifier.ts` | Add `extract()` method + extraction prompts, change `classify()` to text-only summarization |

## Files NOT Modified

| File                                   | Reason                                      |
| -------------------------------------- | ------------------------------------------- |
| `src/main/processor/ocr.ts`            | Kept as-is, just unused                     |
| `src/main/processor/swift/ocr.swift`   | Kept as-is, just unused                     |
| `src/main/processor/embedding.ts`      | No change                                   |
| `src/main/processor/storage.ts`        | No schema change                            |
| `src/shared/types.ts`                  | No type change needed                       |
| `src/main/processor/debug-pipeline.ts` | No change (still dumps prompts + responses) |

---

## Implementation Steps

Each step is a single, testable change. Run `npm run lint && npm run format:check` after each.

### Step 1 — Add `extract()` method and extraction prompts to `SemanticClassifierService`

**File:** `src/main/processor/semantic-classifier.ts`

Add three things, touching nothing existing:

1. A new private method `formatExtractionPrompt(input, events)` that builds the two-image extraction prompt (the full markdown template from the Extraction Prompt Design section above, with `{formatted_events}` filled in via `formatEvent()`).

2. A new private method `formatSingleImageExtractionPrompt(input, events)` — same idea for the single-image app-change case.

3. A new public method `extract(input: ClassificationInput): Promise<string>` that:
   - Reads 1 or 2 images as base64 (reuses existing `imageToBase64`)
   - Picks the right extraction prompt (single vs two-image)
   - Calls `this.client.chat.send(...)` with the vision model + images
   - Tracks usage via `this.usageTracker`
   - Writes to `this.debugWriter` (prompt + response, reuses existing `dump`)
   - Returns the raw markdown string

**How to verify:** Add a temporary log call or unit test that calls `extract()` with a real screenshot pair and prints the markdown. The existing `classify()` still works unchanged — nothing breaks.

### Step 2 — Convert `classify()` from vision to text-only summarization

**File:** `src/main/processor/semantic-classifier.ts`

Change the signature and body of `classify()`:

1. Add a new required parameter `detailedText: string` to `classify()` (or introduce a new method `summarize(detailedText, input)` and keep `classify` as a thin wrapper — either works).

2. Replace the prompt-building logic: instead of `formatPrompt(input)` / `formatSingleImagePrompt(input)`, use a new `formatSummarizationPrompt(detailedText, events)` that builds the text-only summarization prompt from the Summarization Prompt Design section.

3. Remove the `image_url` content blocks from the `content` array — the message becomes a single `text` block. No images sent.

4. The rest stays: usage tracking, debug writer dump, summary history management.

**How to verify:** `npm run lint` passes. Existing callers of `classify()` in `index.ts` will now show a type error (missing `detailedText` param) — that's expected, we fix it in Step 3.

### Step 3 — Rewire `EventProcessor` to the two-pass flow

**File:** `src/main/processor/index.ts`

This is the core orchestration change:

1. **Remove OCR import and call:**
   - Delete `import { extractText } from './ocr'`
   - Remove the `const text = await extractText(filepath)` line and its log line

2. **Remove `startOcrText` state** — extraction now runs at pair-completion time (when END arrives), not per-screenshot. The START screenshot's filepath is already kept in `startScreenshot`.

3. **Update `processScreenshotInternal`:**

   When a screenshot arrives and there is no START yet:
   - Just call `this.setStartState(screenshot)` (filepath only, no text)

   When END arrives (same app):

   ```
   const detailedText = await this.classifierService.extract({ startScreenshot, endScreenshot: screenshot, events })
   const summary = await this.classifierService.classify(detailedText, ...)
   await this.storeAndCleanup(startScreenshot, detailedText, summary, events)
   ```

   When END arrives (app changed):

   ```
   const detailedText = await this.classifierService.extract({ startScreenshot, endScreenshot: undefined, events })
   const summary = await this.classifierService.classify(detailedText, ...)
   await this.storeAndCleanup(startScreenshot, detailedText, summary, events, 'app change')
   ```

   Then END becomes new START as before.

4. **No-classifier fallback:** When `classifierService` is null, store with empty text and empty summary (previously stored OCR text — now there's nothing to extract without the LLM).

5. **Simplify `setStartState`:** Only needs `screenshot`, no `ocrText` param.

6. **Update `storeAndCleanup`:** Rename `ocrText` parameter to `detailedText` for clarity (pure rename, no logic change).

**How to verify:** `npm run lint` passes. Start the app with `DEBUG_PIPELINE=1 npm run dev`, let it capture a pair, and check `.debug-pipeline/` — you should see:

- `prompt.txt` with the extraction prompt (pass 1)
- `response.json` with the detailed markdown
- A second subfolder (or extended dump) with the summarization prompt (pass 2)
- The summary in the response

### Step 4 — Update debug pipeline writer for two-pass visibility

**File:** `src/main/processor/debug-pipeline.ts`

Currently `dump()` writes one prompt + one response per classification. With two passes, we want visibility into both. Two options (pick one):

**Option A — Two dump calls (simplest):** The `extract()` and `classify()` methods each call `debugWriter.dump()` independently. The existing `dump()` method already timestamps subfolders, so they'll be separate folders. Rename the files to distinguish: `extraction-prompt.txt` / `extraction-response.json` and `summary-prompt.txt` / `summary-response.json`.

**Option B — Single combined dump:** Add a `dumpExtraction()` method that writes both passes into one subfolder. More cohesive for debugging but slightly more code.

Recommend **Option A** — zero changes to `debug-pipeline.ts` itself, just call `dump()` twice from `semantic-classifier.ts`. The timestamps keep them ordered.

**How to verify:** Run with `DEBUG_PIPELINE=1 npm run dev`, capture a pair, inspect `.debug-pipeline/` — should see two subfolders per pair, one for extraction, one for summarization.

### Step 5 — Clean up and verify end-to-end

1. Run `npm run lint && npm run format`
2. Run `npm run test` (existing tests should pass since schema is unchanged)
3. Manual smoke test:
   - Start with `DEBUG_PIPELINE=1 npm run dev`
   - Let it capture 3-4 pairs
   - Check `.debug-pipeline/` for correct two-pass dumps
   - Check SQLite via `npm run db:explore`:
     - `text` column should contain rich markdown (not raw OCR lines)
     - `summary` column should contain 5-15 word summaries
     - FTS search should find terms from the detailed markdown
     - Vector search should still work
4. Verify the MCP server still works: start with `--mcp` flag and issue a search query

### Summary of steps

| Step | File(s)                           | What                                 | Risk                           |
| ---- | --------------------------------- | ------------------------------------ | ------------------------------ |
| 1    | `semantic-classifier.ts`          | Add `extract()` + extraction prompts | None — purely additive         |
| 2    | `semantic-classifier.ts`          | Convert `classify()` to text-only    | Low — changes method signature |
| 3    | `index.ts`                        | Rewire OCR → extract→summarize       | Medium — core pipeline change  |
| 4    | `debug-pipeline.ts` or call sites | Two-pass debug visibility            | None — cosmetic                |
| 5    | All                               | Lint, format, test, smoke test       | None — verification only       |
