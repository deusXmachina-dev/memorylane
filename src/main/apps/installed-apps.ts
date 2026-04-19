import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import log from '../logger'
import { normalizeToken, tokenFromBundleId } from '../capture-exclusions'
import type { InstalledApp } from '../../shared/types'

const execFileAsync = promisify(execFile)

const LNK_RESOLVER_TIMEOUT_MS = 15_000
const LNK_RESOLVER_BUFFER_BYTES = 2 * 1024 * 1024

let cachedApps: InstalledApp[] | null = null
let cacheLoadPromise: Promise<InstalledApp[]> | null = null
let cachedAt = 0
const CACHE_TTL_MS = 5 * 60_000

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (cachedApps && Date.now() - cachedAt < CACHE_TTL_MS) return cachedApps
  if (cacheLoadPromise) return cacheLoadPromise

  cacheLoadPromise = loadForPlatform()
  try {
    cachedApps = await cacheLoadPromise
    cachedAt = Date.now()
    return cachedApps
  } finally {
    cacheLoadPromise = null
  }
}

async function loadForPlatform(): Promise<InstalledApp[]> {
  if (process.platform === 'darwin') return loadMacApps()
  if (process.platform === 'win32') return loadWindowsApps()
  return []
}

function dedupeAndSort(apps: InstalledApp[]): InstalledApp[] {
  const byToken = new Map<string, InstalledApp>()
  for (const app of apps) {
    if (!app.matchToken) continue
    if (byToken.has(app.matchToken)) continue
    byToken.set(app.matchToken, app)
  }
  return [...byToken.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  )
}

// ---------------------------------------------------------------------------
// macOS: enumerate .app bundles in standard locations, read CFBundleIdentifier.
// ---------------------------------------------------------------------------

const SEARCH_DIRS_MAC = [
  '/Applications',
  '/Applications/Utilities',
  '/System/Applications',
  '/System/Applications/Utilities',
  path.join(os.homedir(), 'Applications'),
]

async function loadMacApps(): Promise<InstalledApp[]> {
  const bundlePaths = await collectMacAppBundles()
  const resolved = await Promise.all(bundlePaths.map(readMacAppBundle))
  return dedupeAndSort(resolved.filter((app): app is InstalledApp => app !== null))
}

async function collectMacAppBundles(): Promise<string[]> {
  const results: string[] = []
  for (const dir of SEARCH_DIRS_MAC) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.name.endsWith('.app')) continue
        results.push(path.join(dir, entry.name))
      }
    } catch {
      // Directory missing or not accessible — skip.
    }
  }
  return results
}

async function readMacAppBundle(bundlePath: string): Promise<InstalledApp | null> {
  try {
    const plistPath = path.join(bundlePath, 'Contents', 'Info.plist')
    const xml = await readPlistAsXml(plistPath)
    if (!xml) return null

    const bundleId = extractPlistString(xml, 'CFBundleIdentifier')
    if (!bundleId) return null

    const displayName =
      extractPlistString(xml, 'CFBundleDisplayName') ??
      extractPlistString(xml, 'CFBundleName') ??
      path.basename(bundlePath, '.app')

    return { displayName, matchToken: tokenFromBundleId(bundleId) }
  } catch (error) {
    log.debug(`Failed to read app bundle ${bundlePath}: ${error}`)
    return null
  }
}

async function readPlistAsXml(plistPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(plistPath, 'utf8')
    if (raw.startsWith('<?xml')) return raw
  } catch {
    return null
  }

  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', [
      '-convert',
      'xml1',
      '-o',
      '-',
      plistPath,
    ])
    return stdout
  } catch {
    return null
  }
}

function extractPlistString(xml: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`)
  const match = re.exec(xml)
  if (!match) return null
  const decoded = decodeXmlEntities(match[1]).trim()
  return decoded || null
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|apos|quot|lt|gt|#(\d+)|#x([0-9a-fA-F]+));/g, (_, name, dec, hex) => {
    if (dec) return String.fromCodePoint(parseInt(dec, 10))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    switch (name) {
      case 'amp':
        return '&'
      case 'apos':
        return "'"
      case 'quot':
        return '"'
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      default:
        return _
    }
  })
}

// ---------------------------------------------------------------------------
// Windows: enumerate .lnk shortcuts under Start Menu, then resolve each one's
// target via WScript.Shell. Only shortcuts pointing to an .exe become apps —
// this drops .chm manuals, .url docs, and .msc snap-ins that the app-watcher
// would never match at runtime (it reports process exe stems, not Start Menu
// display names).
// ---------------------------------------------------------------------------

interface WindowsShortcut {
  path: string
  displayName: string
}

async function loadWindowsApps(): Promise<InstalledApp[]> {
  const roots = collectWindowsStartMenuRoots()
  const shortcuts: WindowsShortcut[] = []
  for (const root of roots) {
    try {
      await collectWindowsShortcuts(root, shortcuts, 0)
    } catch {
      // Missing / inaccessible — skip.
    }
  }

  if (shortcuts.length === 0) return []

  const filtered = shortcuts.filter((s) => !isWindowsNoise(s.displayName))
  const targets = await resolveWindowsShortcutTargets(filtered.map((s) => s.path))
  const apps: InstalledApp[] = []
  for (const shortcut of filtered) {
    const target = targets.get(normalizePathKey(shortcut.path))
    if (!target) continue
    if (!target.toLowerCase().endsWith('.exe')) continue
    const stem = path.basename(target, path.extname(target))
    const matchToken = normalizeToken(stem)
    if (!matchToken) continue
    apps.push({ displayName: shortcut.displayName, matchToken })
  }
  return dedupeAndSort(apps)
}

function normalizePathKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase()
}

function collectWindowsStartMenuRoots(): string[] {
  const roots: string[] = []
  const programData = process.env.ProgramData
  if (programData) {
    roots.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  }
  const appData = process.env.APPDATA
  if (appData) {
    roots.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  }
  return roots
}

async function collectWindowsShortcuts(
  dir: string,
  out: WindowsShortcut[],
  depth: number,
): Promise<void> {
  if (depth > 3) return
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectWindowsShortcuts(path.join(dir, entry.name), out, depth + 1)
      continue
    }
    if (!entry.name.toLowerCase().endsWith('.lnk')) continue
    const displayName = entry.name.slice(0, -4)
    out.push({ path: path.join(dir, entry.name), displayName })
  }
}

const WINDOWS_NOISE_PATTERNS = ['uninstall', 'readme', 'release notes', 'documentation']

function isWindowsNoise(displayName: string): boolean {
  const lowered = displayName.toLowerCase()
  return WINDOWS_NOISE_PATTERNS.some((p) => lowered.includes(p))
}

function buildShortcutResolverScript(lnkPaths: readonly string[]): string {
  const literals = lnkPaths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$shell = New-Object -ComObject WScript.Shell',
    `$paths = @(${literals})`,
    'foreach ($p in $paths) {',
    '  try {',
    '    $target = $shell.CreateShortcut($p).TargetPath',
    '    if ($target) {',
    '      $safePath = [string]$p -replace "`t", " "',
    '      $safeTarget = [string]$target -replace "`t", " "',
    '      [Console]::Out.WriteLine("$safePath`t$safeTarget")',
    '    }',
    '  } catch {}',
    '}',
  ].join('\n')
}

async function resolveWindowsShortcutTargets(
  lnkPaths: readonly string[],
): Promise<Map<string, string>> {
  if (lnkPaths.length === 0) return new Map()
  const script = buildShortcutResolverScript(lnkPaths)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  let stdout: string
  try {
    stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        {
          encoding: 'utf-8',
          timeout: LNK_RESOLVER_TIMEOUT_MS,
          maxBuffer: LNK_RESOLVER_BUFFER_BYTES,
          windowsHide: true,
        },
        (err, out) => {
          if (err) reject(err)
          else resolve(typeof out === 'string' ? out : out.toString('utf-8'))
        },
      )
    })
  } catch (error) {
    log.warn(`Failed to resolve Windows shortcut targets: ${error}`)
    return new Map()
  }

  const map = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const tabIndex = trimmed.indexOf('\t')
    if (tabIndex < 0) continue
    const lnkPath = trimmed.slice(0, tabIndex)
    const target = trimmed.slice(tabIndex + 1)
    if (!lnkPath || !target) continue
    map.set(normalizePathKey(lnkPath), target)
  }
  return map
}
