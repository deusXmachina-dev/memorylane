/**
 * Detect and format errors thrown by the `bindings` package when better-sqlite3's
 * native binary is missing on disk.
 *
 * Typical cause: npm install scripts were skipped (e.g. `ignore-scripts=true`) or
 * `prebuild-install` couldn't download the prebuilt binary, so no `.node` file
 * was ever placed in `node_modules/better-sqlite3/`.
 *
 * The user-visible symptom is a `Could not locate the bindings file. Tried: ...`
 * stack trace from somewhere deep in `bindings.js`. We replace it with one short
 * actionable message.
 */

const BINDING_ERROR_PREFIX = 'Could not locate the bindings file'

export function isNativeBindingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (typeof err.message === 'string' && err.message.startsWith(BINDING_ERROR_PREFIX)) return true
  if (Array.isArray((err as { tries?: unknown }).tries)) return true
  return false
}

/**
 * Single-line summary suitable for embedding in JSON `error` fields.
 */
export const NATIVE_BINDING_ERROR_SHORT =
  'Memorylane CLI cannot load its SQLite native module (better-sqlite3). ' +
  'Reinstall with install scripts enabled (`npm install -g @deusxmachina-dev/memorylane-cli --foreground-scripts`), ' +
  'or rebuild in place (`npm rebuild better-sqlite3 --foreground-scripts` inside the install dir).'

/**
 * Multi-line, human-friendly hint for stderr output. Tries to derive the
 * actual install directory from the error's `tries` array so we can suggest
 * a copy-paste-ready `cd` command.
 */
export function formatNativeBindingHint(err: unknown): string {
  const tries = (err as { tries?: unknown }).tries
  let installDir: string | undefined
  if (Array.isArray(tries) && tries.length > 0 && typeof tries[0] === 'string') {
    const m = (tries[0] as string).match(/^(.*?)[/\\]node_modules[/\\]better-sqlite3[/\\]/)
    if (m) installDir = m[1]
  }

  const cdLine = installDir
    ? `       cd "${installDir}"`
    : '       cd "$(npm root -g)/@deusxmachina-dev/memorylane-cli"'

  return [
    'Memorylane CLI cannot load its SQLite native module (better-sqlite3).',
    '',
    'This usually means npm install scripts were skipped or the prebuilt',
    'binary was not downloaded during install.',
    '',
    'To fix:',
    '  1. Check that npm install scripts are enabled:',
    '       npm config get ignore-scripts   # must print "false"',
    '',
    '  2. Reinstall with scripts enabled (and visible output):',
    '       npm install -g @deusxmachina-dev/memorylane-cli --foreground-scripts',
    '',
    '  3. Or rebuild the native module in place:',
    cdLine,
    '       npm rebuild better-sqlite3 --foreground-scripts',
    '',
  ].join('\n')
}
