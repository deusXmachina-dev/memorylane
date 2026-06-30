import { StreamJsonlDumper } from './stream-jsonl-dumper'
import type { EventWindow } from '@/shared/types'

/**
 * Appends every EventWindow to a JSONL file in the debug-pipeline directory.
 * This is the replay-critical input: the ActivityProducer consumes a stream of
 * EventWindows (which embed their raw interaction events), so a captured window
 * stream can be fed straight back into a fresh producer during replay without
 * re-running the wall-clock-driven EventCapturer windowing.
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper. Windows reach the event stream only after their
 * events pass the capture blacklist, so excluded titles/URLs never land here —
 * but hand-review fixtures for private content before committing them. Each
 * record carries `dumpedAt` and `lagMs` (dumpedAt - window.endTimestamp).
 */
export class EventWindowDebugDumper extends StreamJsonlDumper<EventWindow> {
  constructor(rootDir: string, fileName = 'event-windows.jsonl') {
    super(rootDir, fileName, 'EventWindowDebugDumper')
  }

  protected referenceTimestamp(window: EventWindow): number {
    return window.endTimestamp
  }
}
