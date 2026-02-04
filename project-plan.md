# Project Plan: MemoryLane v1 - Event Processor Implementation

This document outlines the chronological steps to implement the Event Processor module (v1) as defined in `src/main/processor/SPEC.md`.

## Phase 1: Foundation & OCR

### Ticket 1: Project Dependencies [COMPLETED]
- **Goal:** Set up the environment for vector storage.
- **Tasks:**
  - [x] Install `lancedb` (Node.js client for LanceDB).
  - [x] Verify build configuration works with native modules (Electron/Rebuild).
- **Definition of Done:** `npm install` completes and app starts without native module errors.

### Ticket 2: Swift OCR Sidecar [COMPLETED]
- **Goal:** Implement the native macOS OCR script using the Vision framework.
- **Tasks:**
  - [x] Create directory `src/main/processor/swift/`.
  - [x] Create `ocr.swift` that accepts an image path argument and prints extracted text to stdout.
  - [x] Implement error handling for missing files or permissions.
- **Definition of Done:** Running `swift src/main/processor/swift/ocr.swift ./test.png` in terminal outputs accurate text.

### Ticket 3: OCR Wrapper Module [COMPLETED]
- **Goal:** Create a TypeScript interface to interact with the Swift sidecar.
- **Tasks:**
  - [x] Create `src/main/processor/ocr.ts`.
  - [x] Implement `extractText(filepath: string): Promise<string>`.
  - [x] Use `child_process` to spawn the Swift script.
  - [x] specific handling for "no text found" vs "error".
- **Definition of Done:** A TypeScript function that takes a filepath and returns the text string.

## Phase 2: Storage & Logic

### Ticket 4: Storage Layer (LanceDB) [COMPLETED]
- **Goal:** Implement persistent vector storage for events.
- **Tasks:**
  - [x] Create `src/main/processor/storage.ts`.
  - [x] Initialize LanceDB connection in the app's `userData` directory.
  - [x] Define the schema for the `context_events` table (id, text, timestamp, vector).
  - [x] Implement `addEvent(event: StoredEvent)` method.
- **Definition of Done:** Can programmatically insert a record with a vector and retrieve it.

### Ticket 5: Testing Infrastructure [COMPLETED]
- **Goal:** Set up a proper testing framework to replace manual scripts.
- **Tasks:**
  - [x] Install `vitest`.
  - [x] Configure `vitest.config.ts` (handling native modules).
  - [x] Add `npm test` script to `package.json`.
- **Definition of Done:** Running `npm test` works (even if 0 tests found).

### Ticket 6: Storage Refactor & Tests [COMPLETED]
- **Goal:** Refactor storage to a testable class pattern and add unit tests.
- **Tasks:**
  - [x] Refactor `storage.ts` to export a `StorageService` class (dependency injection style).
  - [x] Create `src/main/processor/storage.test.ts`.
  - [x] Implement tests for: initialization, adding events, schema creation, FTS index creation.
- **Definition of Done:** `StorageService` is clean/stateless and coverage is green.

### Ticket 7: Embedding Module [COMPLETED]
- **Goal:** Create a service to convert text into vector embeddings.
- **Tasks:**
  - [x] Install embedding library (e.g., `@xenova/transformers`).
  - [x] Create `src/main/processor/embedding.ts`.
  - [x] Implement `generateEmbedding(text: string): Promise<number[]>`.
  - [x] Ensure model downloading/caching is handled (or bundled).
- **Definition of Done:** A function that takes a string and returns a valid number array (embedding vector).

### Ticket 8: Processor Orchestrator
- **Goal:** Implement the main business logic pipeline.
- **Tasks:**
  - Create `src/main/processor/index.ts`.
  - Implement `processScreenshot(screenshot: Screenshot): Promise<void>`.
  - Pipeline:
    1. Call OCR Wrapper.
    2. Generate Embedding from text.
    3. Construct Event object (with vector).
    4. Call Storage Layer to save.
    5. Delete the original screenshot file (`fs.unlink`).
- **Definition of Done:** Calling `processScreenshot` with a test file results in a DB entry (with vector) and the file being deleted.

## Phase 3: Integration

### Ticket 9: Main Process Integration
- **Goal:** Connect the real capture loop to the processor.
- **Tasks:**
  - Modify `src/main.ts`.
  - Import the processor module.
  - Subscribe to `capture.onScreenshot`.
  - Pass captured screenshots to the processor.
- **Definition of Done:** Running the app (npm start) automatically processes screenshots every 30s without manual intervention.
