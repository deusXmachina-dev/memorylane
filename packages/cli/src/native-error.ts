const NATIVE_ERROR_CODES = new Set(['MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'])
const BINARY_PATH = /better-sqlite3[/\\](?:build|prebuilds)[/\\]/

export function isNativeBindingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as NodeJS.ErrnoException).code
  return code !== undefined && NATIVE_ERROR_CODES.has(code) && BINARY_PATH.test(err.message)
}

export const NATIVE_BINDING_ERROR_SHORT =
  'MemoryLane CLI cannot load its SQLite native module (better-sqlite3). ' +
  'It needs Node.js 22+ on macOS, Linux, or Windows (x64 or arm64). ' +
  'Reinstall with `npm install -g @deusxmachina-dev/memorylane-cli`.'

export function formatNativeBindingHint(err: unknown): string {
  const message = err instanceof Error ? err.message : ''
  return [
    'MemoryLane CLI cannot load its SQLite native module (better-sqlite3).',
    '',
    `  Node.js: ${process.versions.node} (needs 22 or later)`,
    `  Platform: ${process.platform}-${process.arch} (prebuilt for darwin, linux, win32 on x64 and arm64)`,
    '',
    'To fix, upgrade Node.js if needed, then reinstall:',
    '  npm install -g @deusxmachina-dev/memorylane-cli',
    '',
    `Details: ${message.split('\n')[0]}`,
    '',
  ].join('\n')
}
