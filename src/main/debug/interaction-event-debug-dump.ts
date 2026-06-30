import { StreamJsonlDumper } from './stream-jsonl-dumper'
import type { InteractionContext } from '@/shared/types'

/**
 * Appends every emitted InteractionContext to a JSONL file in the debug-pipeline
 * directory, for inspecting the raw interaction stream (timestamps, durations,
 * interim scroll/typing sub-windows, app changes).
 *
 * Dev-only: wired in runtime.ts behind the same `DEBUG_PIPELINE` gate as the
 * semantic round-trip dumper, and only for events that pass the capture
 * blacklist — excluded window titles/URLs (incl. private browsing) must never
 * reach this plaintext file. Each record carries `dumpedAt` (wall-clock at dump
 * time) and `lagMs` (dumpedAt - event.timestamp) so the debounce delay between
 * when an interaction occurred and when it was emitted is visible at a glance.
 */
export class InteractionEventDebugDumper extends StreamJsonlDumper<InteractionContext> {
  constructor(rootDir: string, fileName = 'interaction-events.jsonl') {
    super(rootDir, fileName, 'InteractionEventDebugDumper')
  }

  protected referenceTimestamp(event: InteractionContext): number {
    return event.timestamp
  }
}
