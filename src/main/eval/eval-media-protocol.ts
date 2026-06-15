/**
 * Streams eval fixture videos to the renderer. A base64 `data:` URL in a
 * `<video>` fails in Electron — media playback needs HTTP range requests for
 * seeking, which `data:` URLs can't serve — so we register a privileged
 * `mlmedia://` scheme and stream `session.mp4` off disk via `net.fetch`, which
 * honors Range requests (206 partial content) for free.
 *
 * URL shape: `mlmedia://eval/<fixtureName>/session.mp4`. The fixture name is the
 * only variable; we `basename()` it and confine the served path to the fixtures
 * root, so the scheme can never read outside `{userData}/eval-fixtures`.
 */

import { protocol, net } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

export const EVAL_MEDIA_SCHEME = 'mlmedia'

/** URL for a fixture's review video. Pure string — safe to call anywhere. */
export function evalMediaUrl(name: string): string {
  return `${EVAL_MEDIA_SCHEME}://eval/${encodeURIComponent(name)}/session.mp4`
}

/** Must be called BEFORE the app `ready` event (top-level in the entry point). */
export function registerEvalMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: EVAL_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ])
}

/** Must be called AFTER `ready`, once the fixtures root is known. */
export function registerEvalMediaProtocol(fixturesRoot: string): void {
  const root = path.resolve(fixturesRoot)

  protocol.handle(EVAL_MEDIA_SCHEME, (request) => {
    try {
      const { pathname } = new URL(request.url)
      const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
      // Expect: /<name>/session.mp4
      if (parts.length !== 2 || parts[1] !== 'session.mp4') {
        return new Response('Not found', { status: 404 })
      }
      const name = path.basename(parts[0]) // strip any traversal
      const filePath = path.resolve(root, name, 'session.mp4')
      if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 })
      }
      // Forward the Range header so seeking yields 206 partial content.
      const range = request.headers.get('range')
      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: range ? { range } : undefined,
      })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}
