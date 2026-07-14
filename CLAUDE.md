# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User-Facing Text

- Keep user-facing text in repo files (release notes, README) and the application (React UI) brief and to the point.
- Prefer the shortest complete wording; remove repeated context and optional detail unless it improves clarity.

## Contributor Guide

- For local setup, test commands, permission checks, and endpoint/storage gotchas, see `docs/CONTRIBUTING.md`.

## Project Overview

MemoryLane is a system tray Electron application that captures screenshots at regular intervals. Built with TypeScript using electron-vite for development and electron-builder for packaging. The application runs as a tray-only app (no main window) and captures screenshots based on user interaction and visual changes.

## E2E Tests

- Standalone E2E runners live in `e2e-tests/`.
- they will usually contain helpers in packge.json

## Architecture

### Native Sidecars (`native/`)

`native/` contains first-party native sidecar binaries (different from native Node.js addons in `node_modules`). Example is app-watcher module for windows.

### Main Components

1. **Main Process** (`src/main/index.ts`): Entry point and tray management
   - Creates system tray with menu (Start/Stop Capture, Capture Now, Quit)
   - Handles app lifecycle as a tray app (doesn't quit when windows close)
   - Hides dock icon on macOS for pure tray experience
   - Integrates with recorder and processor modules

2. **Recorder Module** (`src/main/recorder/`): Screenshot capture
   - Uses Electron's `desktopCapturer` API to capture screens
   - Saves screenshots as PNG files to `{userData}/screenshots/`
   - Event-driven capture based on user interaction and visual changes
   - Exposes API for downstream consumers via callback system

3. **Processor Module** (`src/main/processor/`): Screenshot processing
   - OCR using macOS Vision framework (Swift)
   - Vector embeddings using Transformers.js
   - Storage using SQLite (better-sqlite3 + sqlite-vec) for persistence, FTS, and vector search

### Build System

The project uses electron-vite for development and electron-builder for packaging:

- **electron.vite.config.ts**: Unified Vite configuration
  - Configures main, preload, and renderer builds
  - Handles native module externalization
  - Source maps enabled for debugging

- **electron-builder.config.js**: Packaging configuration
  - Defines targets for macOS and Windows
  - Configures ASAR unpacking for native modules
  - Handles asset copying to resources

### Editions

The app currently supports two editions:

- `customer`
- `enterprise`

Build selection is done with the `EDITION` environment variable in packaging scripts. The edition-specific build commands set it explicitly and `electron-builder.config.js` uses it to choose packaging metadata and bundle the matching `config/editions/<edition>.json` file.

At runtime, the app loads the edition config once during startup in `src/main/edition.ts`, validates it, and exposes the resolved config object to the rest of the app. In development, `EDITION` selects which config file to load; in packaged builds, the bundled `resources/config/edition.json` file is loaded.

### Native Modules

This project uses several native Node.js modules that require special handling:

- `uiohook-napi` - Keyboard/mouse monitoring
- `sharp` - Image processing
- `better-sqlite3` - SQLite database
- `onnxruntime-node` - ML inference

These are:

1. Externalized in Vite (not bundled)
2. Rebuilt for Electron via `postinstall` script
3. Unpacked from ASAR via electron-builder config

### Single-Runtime Environment

All scripts run under Electron's Node.js via `scripts/enode.sh`. Native modules are compiled once for Electron during `npm install` (via postinstall) and never need rebuilding. This eliminates ABI mismatch errors when switching between tests and dev.

The `enode.sh` wrapper sets `ELECTRON_RUN_AS_NODE=1` and executes the command through Electron's bundled Node.js binary. This ensures tests (`npm test`), utility scripts (`npm run db:stats`, etc.), and the Electron app itself all use the same ABI.

### TypeScript Configuration

- Path aliases (configured in both Vite and TypeScript):
  - `@/` maps to `src/`
  - `@main/` maps to `src/main/`
  - `@components/` maps to `src/renderer/components/`
  - `@types` maps to `src/shared/types`
  - Use these aliases instead of deep relative paths. `src/main` modules import siblings via `@main/<dir>/...` so files stay movable between subdirectories.

## Database Migrations

- Migrations (`src/main/storage/migrations/`) are immutable once shipped. Never edit an existing migration to change the schema — add a new one. The only exceptions: a migration you created in the current PR that has not been applied yet, or when the user explicitly tells you to edit it.
- To change the schema, add a new migration file and register it in `migrations/index.ts`.

## UI Guidelines

- Prefer React UI components (modals, toasts, inline messages) over browser-native dialogs (`alert()`, `confirm()`, `prompt()`).

## Findings

The `findings/` directory contains benchmark results, prompt experiments, and other research artifacts. When working on prompts or LLM-related features, check this folder first and reuse or update existing results rather than starting from scratch.

## Key Patterns

### Tray App Behavior

- No main window created by default (pure tray app)
- Dock icon hidden on macOS for cleaner system tray experience
- App doesn't quit when all windows close
- Tray menu dynamically updates based on capture state

## Multi-Agent Workflow

Multiple agents may be working concurrently on the current branch. When committing changes, only stage and commit the files you personally modified — do not use `git add -A` or `git add .`.

## Asking for estimates

When asking questions like: "What would it take to implement X?" "How difficult would implementing X be?"
Provide concrete steps that need doing and how much it complicates the codebase.
NEVER provide vague time estimates like 2-3 days unless asked explicitly.
