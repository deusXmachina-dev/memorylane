/**
 * Standalone CLI entry point.
 *
 * Runs under ELECTRON_RUN_AS_NODE=1 so native modules stay ABI-compatible.
 * Mirrors the MCP tools (search_context, browse_timeline, get_activity_details)
 * as simple shell commands that agents can invoke directly.
 *
 * The shell wrapper (bin/memorylane) redirects stdout to stderr and passes the
 * original stdout as fd 3 via CLI_STDOUT_FD=3. This entry point opens that fd
 * as a Writable and passes it to the CLI runner, keeping logger/dotenv noise
 * out of the real stdout channel.
 */

import { Writable } from 'node:stream'
import * as fs from 'node:fs'
import { config as loadEnv } from 'dotenv'

try {
  loadEnv()
} catch {
  // cwd might not be available in packaged app context
}

import { run } from './cli/index'

// If the wrapper passed a real-stdout fd, open a Writable to it.
// Otherwise fall back to process.stdout (dev/npm-script mode).
// Uses fs.writeSync so output is flushed before process.exit().
let stdout: Writable | undefined
const fdStr = process.env.CLI_STDOUT_FD
if (fdStr) {
  const fd = parseInt(fdStr, 10)
  stdout = new Writable({
    write(chunk, _encoding, callback): void {
      try {
        fs.writeSync(fd, typeof chunk === 'string' ? chunk : Buffer.from(chunk))
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
  })
}

run(process.argv.slice(2), stdout).then((code) => {
  process.exit(code)
})
