/**
 * Reads/writes task-mining goldens built in-app, under `{userData}/task-fixtures`.
 * Backs the Developer → Tasks UI: list goldens, load one for editing (its
 * `golden.md`), save the edited golden, export a fixture as a zip to hand back
 * into the repo (`evals/task-mining/fixtures/`), and delete.
 *
 * Mirrors `EvalFixtureStore`, but a task fixture has no video — it's
 * `manifest.json` + `activities.jsonl` + `golden.md`.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yazl from 'yazl'
import log from '../logger'
import type { TaskFixtureActivity, TaskFixtureManifest } from './task-types'
import type { TaskFixtureLoad, TaskFixtureSummary } from '../../shared/eval-review'

/** Filesystem-safe single path segment from a free-text name. */
export function sanitizeFixtureName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'fixture'
}

export class TaskFixtureStore {
  constructor(private readonly root: string) {}

  /** Resolve a fixture's directory. Sanitizing keeps names single, safe path
   *  segments — also guards against path traversal. */
  private dirFor(name: string): string {
    return path.join(this.root, sanitizeFixtureName(name))
  }

  /**
   * Writes a freshly built fixture (`activities.jsonl` + `golden.md` +
   * `manifest.json`). Returns its summary. The name is sanitized; if a fixture
   * with that name exists it is overwritten.
   */
  write(
    name: string,
    activities: TaskFixtureActivity[],
    goldenMd: string,
    manifest: TaskFixtureManifest,
  ): TaskFixtureSummary {
    const safe = sanitizeFixtureName(name)
    const dir = this.dirFor(name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'activities.jsonl'),
      activities.map((a) => JSON.stringify(a)).join('\n') + '\n',
      'utf8',
    )
    fs.writeFileSync(path.join(dir, 'golden.md'), goldenMd, 'utf8')
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ ...manifest, name: safe }, null, 2) + '\n',
      'utf8',
    )
    return {
      name: safe,
      label: manifest.label,
      sourceDay: manifest.sourceDay ?? null,
      activityCount: manifest.activityCount,
      createdAt: fs.statSync(path.join(dir, 'manifest.json')).mtimeMs,
    }
  }

  private readManifest(dir: string): TaskFixtureManifest | null {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'),
      ) as TaskFixtureManifest
    } catch {
      return null
    }
  }

  list(): TaskFixtureSummary[] {
    if (!fs.existsSync(this.root)) return []
    const out: TaskFixtureSummary[] = []
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = path.join(this.root, entry.name)
      const manifest = this.readManifest(dir)
      if (!manifest) continue
      let createdAt = 0
      try {
        createdAt = fs.statSync(path.join(dir, 'manifest.json')).mtimeMs
      } catch {
        // leave as 0
      }
      out.push({
        name: entry.name,
        label: manifest.label,
        sourceDay: manifest.sourceDay ?? null,
        activityCount: manifest.activityCount,
        createdAt,
      })
    }
    // Newest first.
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }

  load(name: string): TaskFixtureLoad | null {
    const dir = this.dirFor(name)
    const manifest = this.readManifest(dir)
    if (!manifest) return null
    const goldenPath = path.join(dir, 'golden.md')
    const goldenMd = fs.existsSync(goldenPath) ? fs.readFileSync(goldenPath, 'utf8') : ''
    return { name: sanitizeFixtureName(name), label: manifest.label, goldenMd }
  }

  saveGolden(name: string, markdown: string): void {
    const dir = this.dirFor(name)
    if (!fs.existsSync(dir)) throw new Error(`Fixture not found: ${name}`)
    fs.writeFileSync(path.join(dir, 'golden.md'), markdown, 'utf8')
  }

  delete(name: string): void {
    fs.rmSync(this.dirFor(name), { recursive: true, force: true })
  }

  /** Zips the fixture dir to `destPath`, entries rooted at `<name>/`. */
  async exportZip(name: string, destPath: string): Promise<void> {
    const dir = this.dirFor(name)
    if (!fs.existsSync(dir)) throw new Error(`Fixture not found: ${name}`)

    const files: { real: string; entry: string }[] = []
    const walk = (current: string, rel: string): void => {
      for (const e of fs.readdirSync(current, { withFileTypes: true })) {
        const real = path.join(current, e.name)
        const entry = path.posix.join(rel, e.name)
        if (e.isDirectory()) walk(real, entry)
        else if (e.isFile()) files.push({ real, entry })
      }
    }
    walk(dir, sanitizeFixtureName(name))

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const zip = new yazl.ZipFile()
      const output = fs.createWriteStream(destPath)
      const onError = (error: unknown): void =>
        reject(error instanceof Error ? error : new Error(String(error)))
      output.once('error', onError)
      zip.outputStream.once('error', onError)
      output.once('close', resolve)
      zip.outputStream.pipe(output)
      for (const f of files) zip.addFile(f.real, f.entry)
      zip.end()
    })
    log.info(`[TaskFixtureStore] Exported "${name}" (${files.length} files) -> ${destPath}`)
  }
}
