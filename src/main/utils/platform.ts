/**
 * Maps the host OS to the platform token the backend expects (macOS bundle ids
 * vs. Windows process names). Returns null on any other platform so callers can
 * omit it — the backend only knows these two.
 */
export function backendPlatformToken(): 'macos' | 'windows' | null {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return null
}
