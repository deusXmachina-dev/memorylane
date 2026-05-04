# Contributing to MemoryLane

This guide is intentionally lightweight. Prefer stable patterns over exhaustive checklists so the doc stays useful as the code evolves.

## Philosophy

- Keep changes modular and testable (for example native sidecars with integration tests).
- Prefer co-located tests next to changed code.
- Validate behavior end-to-end when touching capture, permissions, or semantic processing.
- Provide validation tooling with the change when practical.
- Document non-obvious tradeoffs in code comments or focused docs.

## Local Setup

```bash
npm install
npm run dev
```

Notes:

- Use `npm` (the repo is lockfile-driven with `package-lock.json`).
- Native prerequisites are built via repo scripts; if native capture tests fail, rebuild the platform-native binary (`build:swift` on macOS, `build:rust` on Windows).
- For pipeline diagnostics, run:

```bash
npm run dev:debug-pipeline
```

## Build Notes

- `npm run build` compiles app code only.
- `npm run make` (or `make:mac` / `make:win`) creates installable artifacts.
- Enterprise builds bake the backend URL in at build time. Override the default with `MEMORYLANE_BACKEND_URL` for per-customer builds, e.g.
  `MEMORYLANE_BACKEND_URL=https://acme.trymemorylane.com/ npm run make:enterprise:mac`.
- Treat local builds as developer artifacts unless signing/notarization is configured.
- Release CI in [`.github/workflows/release.yml`](C:\Users\fkubi\Documents\dxm\memorylane-1.github\workflows\release.yml) expects signing secrets and fails early when they are missing.

## Signing and Notarization Tradeoffs

- macOS without notarization: users can hit Gatekeeper friction (extra trust prompts / manual open path) even if the app is signed.
- Windows without trusted signing: SmartScreen typically shows stronger warnings and can block installs in managed environments.
- Unsigned or partially signed artifacts are acceptable for internal development and CI validation, but not ideal for end-user distribution.
- If signing or notarization is intentionally skipped, call this out clearly in release notes/testing notes so QA expectations match reality.

## Testing Approach

Start with:

```bash
npm run test
```

Then run targeted integration checks relevant to your change (see `package.json` scripts and nearby `*.integration.test.ts` files).

Some changes like those touching permissions or MCP setup of the built app, might require infrequent manual testing using the built application.

Patterns:

- Prefer the smallest test surface that proves your change.
- For semantic endpoint changes, test both default OpenRouter flow and custom endpoint behavior.
- For capture pipeline changes, include at least one manual run that confirms activities are persisted.

### Manual Validation Patterns

- Permissions (macOS): verify Accessibility and Screen Recording flow via `src/main/ui/permissions.ts`.

#### Pipeline changes

Test that pipeline provides correct outcomes for specific scenarios:

```bash
npm run dev:debug-pipeline
```

- Capture flow: verify capture starts, activities are created, and cleanup runs.
- Semantic flow: verify fallback behavior when a custom endpoint does not support video inputs.

Ideally individual modules of the pipeline will include integration tests which can be used automatically/agentically.

Reference integration test:

- `src/main/activity-semantic-service.ollama.integration.test.ts`

## Storage and Cleanup Model

Raw screenshots are written under `{userData}/screenshots`, where `userData` is Electron's runtime path (`app.getPath('userData')`). Activity text is persisted in SQLite in the same `userData` root.

After activity extraction:

- frame/video media is deleted as part of activity cleanup;
- a periodic stale-file sweep removes older leftover media.
