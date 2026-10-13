/**
 * Reads/writes promoted eval fixtures under `{userData}/eval-fixtures`. Backs the
 * in-app Developer review UI: list fixtures, load one for review (its `golden.md`
 * + a `mlmedia://` URL for the review video — streamed off disk so `<video>`
 * seeking works; a base64 data URL does not play in Electron), save the edited
 * golden, export a fixture as a zip to hand back, and delete.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as yazl from 'yazl'
import log from '@main/utils/logger'
import type { DumpedFrame, FixtureManifest } from './types'
import type {
  EvalEventWindow,
  EvalFixtureLoad,
  EvalFixtureSummary,
  GoldenBlock,
  ScriptCheck,
} from '@/shared/eval-review'
import type { EventWindow, InteractionContext } from '@/shared/types'
import { readJsonl } from './jsonl'
import { describeInteraction } from '@main/semantic/prompt'
import { evalMediaUrl } from './eval-media-protocol'
import { formatGoldenMd, parseGoldenMd } from './golden-md'

const INTERACTION_TYPES = new Set<InteractionContext['type']>([
  'click',
  'keyboard',
  'scroll',
  'app_change',
])

/** Staging dir for in-progress recordings — never listed as a fixture. */
const STAGING_DIR = '.staging'

export class EvalFixtureStore {
  constructor(private readonly root: string) {}

  private dirFor(name: string): string {
    // Guard against path traversal — names are single path segments.
    const base = path.basename(name)
    return path.join(this.root, base)
  }

  private readManifest(dir: string): FixtureManifest | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as FixtureManifest
    } catch {
      return null
    }
  }

  list(): EvalFixtureSummary[] {
    if (!fs.existsSync(this.root)) return []
    const out: EvalFixtureSummary[] = []
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === STAGING_DIR) continue
      const dir = path.join(this.root, entry.name)
      const manifest = this.readManifest(dir)
      if (!manifest) continue
      out.push({
        name: entry.name,
        label: manifest.label,
        capturedAt: manifest.capturedAt,
        frameCount: manifest.frameCount,
        eventWindowCount: manifest.eventWindowCount,
        appMix: manifest.appMix,
        hasVideo: fs.existsSync(path.join(dir, 'session.mp4')),
        scriptId: manifest.script ?? null,
        scriptFollowed: manifest.script ? (this.readScriptCheck(dir)?.followed ?? false) : null,
      })
    }
    // Newest first.
    out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    return out
  }

  load(name: string): EvalFixtureLoad | null {
    const dir = this.dirFor(name)
    const manifest = this.readManifest(dir)
    if (!manifest) return null

    const goldenPath = path.join(dir, 'golden.md')
    const goldenMd = fs.existsSync(goldenPath) ? fs.readFileSync(goldenPath, 'utf8') : ''

    const hasVideo = fs.existsSync(path.join(dir, 'session.mp4'))
    const videoUrl = hasVideo ? evalMediaUrl(path.basename(name)) : null

    const eventWindows = this.loadEventWindows(dir)

    return {
      name: path.basename(name),
      label: manifest.label,
      goldenMd,
      goldenBlocks: parseGoldenMd(goldenMd),
      scriptId: manifest.script ?? null,
      scriptCheck: this.readScriptCheck(dir),
      videoUrl,
      eventWindows,
    }
  }

  private readScriptCheck(dir: string): ScriptCheck | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'script-check.json'), 'utf8')) as ScriptCheck
    } catch {
      return null
    }
  }

  /**
   * Reads `event-windows.jsonl` into a display-ready, window-grouped timeline.
   * Offsets anchor to the same session-start clock as the video and golden mm:ss
   * (min frame timestamp, falling back to the earliest window start), so the
   * review UI lines up across all three columns.
   */
  private loadEventWindows(dir: string): EvalEventWindow[] {
    const windowsPath = path.join(dir, 'event-windows.jsonl')
    if (!fs.existsSync(windowsPath)) return []
    const windows = readJsonl<EventWindow>(windowsPath)
    if (windows.length === 0) return []

    const sessionStartMs = this.sessionStartMs(dir, windows)
    return windows.map((w) => {
      const events = w.events
        .filter((e) => INTERACTION_TYPES.has(e.type))
        .sort((a, b) => a.timestamp - b.timestamp)
      return {
        startOffsetMs: w.startTimestamp - sessionStartMs,
        endOffsetMs: w.endTimestamp - sessionStartMs,
        closedBy: w.closedBy,
        appLabel: appLabelOf(events),
        events: events.map((e) => ({
          offsetMs: e.timestamp - sessionStartMs,
          type: e.type,
          text: describeInteraction(e),
        })),
      }
    })
  }

  /** Video/golden clock zero: earliest frame timestamp, else earliest window. */
  private sessionStartMs(dir: string, windows: EventWindow[]): number {
    const framesPath = path.join(dir, 'frames.jsonl')
    if (fs.existsSync(framesPath)) {
      const frames = readJsonl<DumpedFrame>(framesPath)
      if (frames.length > 0) return Math.min(...frames.map((f) => f.timestamp))
    }
    return Math.min(...windows.map((w) => w.startTimestamp))
  }

  saveGolden(name: string, markdown: string): void {
    const dir = this.dirFor(name)
    if (!fs.existsSync(dir)) throw new Error(`Fixture not found: ${name}`)
    fs.writeFileSync(path.join(dir, 'golden.md'), markdown, 'utf8')
  }

  saveGoldenBlocks(name: string, blocks: GoldenBlock[]): void {
    this.saveGolden(name, formatGoldenMd(path.basename(name), blocks))
  }

  delete(name: string): void {
    const dir = this.dirFor(name)
    fs.rmSync(dir, { recursive: true, force: true })
  }

  /** Zips the fixture dir to `destPath`, entries rooted at `<name>/`. */
  async exportZip(name: string, destPath: string): Promise<void> {
    const dir = this.dirFor(name)
    if (!fs.existsSync(dir)) throw new Error(`Fixture not found: ${name}`)
    const files = listFiles(dir, path.basename(name))
    await writeZip(files, destPath)
    log.info(`[EvalFixtureStore] Exported "${name}" (${files.length} files) -> ${destPath}`)
  }

  /** Every recording plus the scenarios file, in one zip. */
  async exportAllZip(destPath: string): Promise<number> {
    const names = this.list().map((f) => f.name)
    if (names.length === 0) throw new Error('No recordings to export')
    const files = names.flatMap((name) => listFiles(this.dirFor(name), name))
    const scenarios = path.join(this.root, 'scenarios.json')
    if (fs.existsSync(scenarios)) files.push({ real: scenarios, entry: 'scenarios.json' })
    await writeZip(files, destPath)
    log.info(`[EvalFixtureStore] Exported ${names.length} recordings -> ${destPath}`)
    return names.length
  }
}

function listFiles(dir: string, rel: string): { real: string; entry: string }[] {
  const files: { real: string; entry: string }[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const real = path.join(dir, e.name)
    const entry = path.posix.join(rel, e.name)
    if (e.isDirectory()) files.push(...listFiles(real, entry))
    else if (e.isFile()) files.push({ real, entry })
  }
  return files
}

async function writeZip(files: { real: string; entry: string }[], destPath: string): Promise<void> {
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
}

/** First app/window context in a window, as "processName — title" (or null). */
function appLabelOf(events: InteractionContext[]): string | null {
  const win = events.find((e) => e.activeWindow)?.activeWindow
  if (!win) return null
  return win.title ? `${win.processName} — ${win.title}` : win.processName
}
