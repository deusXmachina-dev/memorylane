import { StreamJsonlDumper } from './stream-jsonl-dumper'
import type { Frame } from '@main/recorder/screen-capturer'

/**
 * Appends every captured Frame to a JSONL file in the debug-pipeline directory,
 * recording the screenshot's metadata (path, timestamp, dimensions, display,
 * sequence number) as it enters the frame stream.
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper. The referenced PNGs survive on disk because the
 * debug pipeline forces `retainScreenshots`, so a session's frames can later be
 * promoted into a replay fixture. No blacklist routing is needed: frames for
 * blocked apps are suppressed upstream at the capturer and never reach the
 * stream. Each record carries `dumpedAt` and `lagMs` (dumpedAt - frame.timestamp).
 */
export class FrameDebugDumper extends StreamJsonlDumper<Frame> {
  constructor(rootDir: string, fileName = 'frames.jsonl') {
    super(rootDir, fileName, 'FrameDebugDumper')
  }

  protected referenceTimestamp(frame: Frame): number {
    return frame.timestamp
  }
}
