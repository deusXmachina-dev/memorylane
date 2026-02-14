# Windows Native OCR Migration Plan

This plan replaces the current Windows Tesseract CLI OCR backend with a native Windows OCR backend.

## Goal

- Remove the external Tesseract dependency for Windows users.
- Use native Windows OCR APIs for local, on-device OCR.
- Keep screenshot processing non-blocking when OCR is unavailable or fails.

## Current State

- Windows OCR is implemented via `spawn('tesseract', ...)` in `src/main/processor/ocr-windows.ts`.
- `src/main/processor/ocr.ts` routes `win32` to that backend.
- Failure mode is explicit: OCR fails when Tesseract is not installed or not on `PATH`.

## Target Architecture

1. Keep `extractText(filepath)` in `src/main/processor/ocr.ts` as the cross-platform entrypoint.
2. Replace the Windows backend implementation with a native Windows OCR adapter.
3. Keep strict platform routing:
   - `darwin` -> existing Swift/Vision backend
   - `win32` -> new native Windows backend
4. Standardize backend error contracts so callers receive actionable, user-friendly errors.

## Implementation Phases

## Phase 1 - Backend Interface Hardening

1. Keep/confirm shared backend signature: `(filepath: string) => Promise<string>`.
2. Define Windows OCR error categories in code comments/docs:
   - API unavailable on host OS/build
   - image decode/read failures
   - OCR runtime failure
3. Ensure all backend errors include clear remediation guidance where possible.

Acceptance criteria:

- OCR backends expose uniform async behavior and predictable error text.

## Phase 2 - Implement Native Windows OCR Backend

1. Create a new Windows-native backend module (for example `src/main/processor/ocr-windows-native.ts`).
2. Implement OCR via Windows native OCR APIs (WinRT OCR path).
3. Convert image file input to the API-expected buffer/bitmap format.
4. Return extracted text as a plain string (trimmed, stable output format).
5. Add a backend capability probe to fail fast with clear diagnostics when native OCR is unavailable.

Acceptance criteria:

- `extractText(...)` on Windows uses native OCR with no Tesseract dependency.
- Typical screenshots return OCR text successfully on supported Windows environments.

## Phase 3 - Integrate and Remove Tesseract Requirement

1. Update `src/main/processor/ocr.ts` to route Windows to the native backend.
2. Remove Tesseract-specific error/help text from runtime paths.
3. Keep OCR failure handling explicit and non-crashing (log and continue processing).
4. Delete Tesseract-only backend file once migration is complete.

Acceptance criteria:

- No runtime requirement for `tesseract` or PATH setup on Windows.
- Event processing remains stable under both OCR success and OCR failure.

## Phase 4 - Tests and Validation

1. Add unit tests for Windows backend behavior:
   - successful OCR result path
   - unavailable API path
   - invalid/missing image path
2. Add integration coverage around processor behavior when OCR throws on Windows.
3. Run validation matrix:
   - `npm test`
   - `npm run dev` on Windows
   - manual capture flow producing processed events

Acceptance criteria:

- Tests cover success and failure paths for new Windows OCR backend.
- Manual Windows smoke test confirms OCR output in normal usage.

## Phase 5 - Documentation and Release Notes

1. Update `README.md`:
   - remove/replace "install Tesseract" requirement
   - document native OCR support scope and any Windows version constraints
2. Add troubleshooting section for native OCR failures.
3. Note migration in `RELEASE_NOTES.md`.

Acceptance criteria:

- Windows setup documentation no longer requires Tesseract installation.
- Troubleshooting guidance is actionable and user-facing.

## Risk Register

- Native API bindings may introduce packaging complexity in Electron builds.
- OCR quality/output may differ from Tesseract for some fonts/layouts.
- Some Windows editions/builds may have feature differences requiring capability checks.
- Performance characteristics may vary for high-resolution screenshots.

## Done Definition

- Windows OCR works out-of-the-box after app install (no extra OCR dependency setup).
- Tesseract-specific Windows OCR code paths are removed.
- Documentation and release notes reflect the native Windows OCR backend.
