import * as fs from 'fs'
import type { InteractionContext } from '@/shared/types'

/** Reads a JSONL file into typed records, skipping blank lines. */
export function readJsonl<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T)
}

const LEGACY_EVENT_TYPES = new Set<string>(['presence'])

/** Drops event types older recordings contain but the pipeline no longer emits. */
export function dropLegacyEvents(events: InteractionContext[]): InteractionContext[] {
  return events.filter((event) => !LEGACY_EVENT_TYPES.has(event.type))
}
