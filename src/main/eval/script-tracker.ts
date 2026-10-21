import { isSelfApp } from '@main/capture/capture-exclusions'
import type { AppWatcherEvent } from '@main/recorder/app-watcher'
import { extractTld } from '@main/recorder/tld-utils'
import type { RecordingScriptStep } from '@/shared/eval-review'
import { appMatches, hostMatches } from './script-golden'

export function enteredStep(step: RecordingScriptStep, event: AppWatcherEvent): boolean {
  if (event.type !== 'app_change' && event.type !== 'window_change') return false
  if (isSelfApp(event)) return false
  if (!appMatches(step.expect.app, { processName: event.app ?? '', bundleId: event.bundleId })) {
    return false
  }
  return !step.expect.tld || hostMatches(step.expect.tld, extractTld(event.url))
}
