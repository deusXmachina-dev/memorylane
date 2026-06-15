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
import log from '../logger'
import type { FixtureManifest } from './types'
import type { EvalFixtureLoad, EvalFixtureSummary } from '../../shared/eval-review'
import { evalMediaUrl } from './eval-media-protocol'

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

    return { name: path.basename(name), label: manifest.label, goldenMd, videoUrl }
  }

  saveGolden(name: string, markdown: string): void {
    const dir = this.dirFor(name)
    if (!fs.existsSync(dir)) throw new Error(`Fixture not found: ${name}`)
    fs.writeFileSync(path.join(dir, 'golden.md'), markdown, 'utf8')
  }

  delete(name: string): void {
    const dir = this.dirFor(name)
    fs.rmSync(dir, { recursive: true, force: true })
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
    walk(dir, path.basename(name))

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
    log.info(`[EvalFixtureStore] Exported "${name}" (${files.length} files) -> ${destPath}`)
  }
}
