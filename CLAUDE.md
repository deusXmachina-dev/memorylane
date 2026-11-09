# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## User-Facing Text

- Keep user-facing text in repo files (release notes, README) and the application (React UI) brief and to the point.
- Prefer the shortest complete wording; remove repeated context and optional detail unless it improves clarity.

## Docs vs. Code

When a repository's documentation and its existing code disagree, follow the
conventions in the existing code. In your final reply, list each inconsistency
you found between the documentation and the code.

## Contributor Guide

- For local setup, test commands, permission checks, and endpoint/storage gotchas, see `docs/CONTRIBUTING.md`.

## Project Overview

MemoryLane is a system tray Electron application that captures screenshots at regular intervals. Built with TypeScript using electron-vite for development and electron-builder for packaging. It lives in the system tray with an optional main window and captures screenshots based on user interaction and visual changes.

## Architecture

### Native Sidecars (`native/`)

`native/` contains first-party native sidecar binaries (different from native Node.js addons in `node_modules`). Example is app-watcher module for windows.

### Editions

The app currently supports two editions:

- `customer`
- `enterprise`

Build selection is done with the `EDITION` environment variable in packaging scripts. The edition-specific build commands set it explicitly and `electron-builder.config.js` uses it to choose packaging metadata and bundle the matching `config/editions/<edition>.json` file.

At runtime, the app loads the edition config once during startup in `src/main/system/edition.ts`, validates it, and exposes the resolved config object to the rest of the app. In development, `EDITION` selects which config file to load; in packaged builds, the bundled `resources/config/edition.json` file is loaded.

### Native Modules

Native Node.js modules (`uiohook-napi`, `sharp`, `better-sqlite3`, `onnxruntime-node`, …) must be externalized in Vite, rebuilt for Electron via `postinstall`, and unpacked from ASAR in electron-builder config. Keep all three in sync when adding one.

### Single-Runtime Environment

All scripts run under Electron's Node.js via `scripts/enode.js`. Native modules are compiled once for Electron during `npm install` (via postinstall) and never need rebuilding. This eliminates ABI mismatch errors when switching between tests and dev.

The wrapper sets `ELECTRON_RUN_AS_NODE=1` and executes the command through Electron's bundled Node.js binary. This ensures tests (`npm test`), utility scripts (`npm run db:stats`, etc.), and the Electron app itself all use the same ABI.

### TypeScript Configuration

- Path aliases are defined in `tsconfig*.json` and `electron.vite.config.ts`. Use them instead of deep relative paths. `src/main` modules import siblings via `@main/<dir>/...` so files stay movable between subdirectories.

## Database Migrations

- Migrations (`src/main/storage/migrations/`) are immutable once shipped. Never edit an existing migration to change the schema — add a new one. The only exceptions: a migration you created in the current PR that has not been applied yet, or when the user explicitly tells you to edit it.
- To change the schema, add a new migration file and register it in `migrations/index.ts`.

## UI Guidelines

- Prefer React UI components (modals, toasts, inline messages) over browser-native dialogs (`alert()`, `confirm()`, `prompt()`).
- Styling comes from the shadcn design preset <https://ui.shadcn.com/create?preset=bJMTbSgy>. Never edit the preset tokens in `src/renderer/index.css` (`:root`/`.dark`); adjust looks via component `className`s.

## Findings

The `findings/` directory contains benchmark results, prompt experiments, and other research artifacts. When working on prompts or LLM-related features, check this folder first and reuse or update existing results rather than starting from scratch.

## Multi-Agent Workflow

Multiple agents may be working concurrently on the current branch. When committing changes, only stage and commit the files you personally modified — do not use `git add -A` or `git add .`.

## Asking for estimates

When asking questions like: "What would it take to implement X?" "How difficult would implementing X be?"
Provide concrete steps that need doing and how much it complicates the codebase.
NEVER provide vague time estimates like 2-3 days unless asked explicitly.
