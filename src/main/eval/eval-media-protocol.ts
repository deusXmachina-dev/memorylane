/**
 * Streams eval fixture videos to the renderer. A base64 `data:` URL in a
 * `<video>` fails in Electron — media playback needs HTTP range requests for
 * seeking, which `data:` URLs can't serve — so we register a privileged
 * `mlmedia://` scheme and stream `session.mp4` off disk, serving Range
 * requests as 206 partial content ourselves (Electron's `net.fetch` over
 * `file://` ignores Range and returns the whole file, which breaks seeking).
 *
 * URL shape: `mlmedia://eval/<fixtureName>/session.mp4`. The fixture name is the
 * only variable; we `basename()` it and confine the served path to the fixtures
 * root, so the scheme can never read outside `{userData}/eval-fixtures`.
 */

import { protocol } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'

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

      const size = fs.statSync(filePath).size
      const toWebBody = (start: number, end: number): ReadableStream =>
        Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream

      // Serve Range requests as 206 partial content so the <video> can seek.
      const rangeHeader = request.headers.get('range')
      const match = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0
        let end = match[2] ? parseInt(match[2], 10) : size - 1
        if (Number.isNaN(start)) start = 0
        if (Number.isNaN(end) || end >= size) end = size - 1
        if (start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          })
        }
        return new Response(toWebBody(start, end), {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
          },
        })
      }

      return new Response(toWebBody(0, size - 1), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
        },
      })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}
