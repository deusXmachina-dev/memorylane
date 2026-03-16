import type { PatternMatch, PatternNotificationService } from './types'

export class NoopPatternNotificationService implements PatternNotificationService {
  async notify(match: PatternMatch): Promise<void> {
    void match
    return
  }
}
