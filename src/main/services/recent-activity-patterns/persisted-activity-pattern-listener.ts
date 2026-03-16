import type {
  ActivityPersistedListener,
  ActivityPersistedListenerInput,
} from '../../activity-extraction-types'
import type { PatternRepository } from '../../storage/pattern-repository'
import { PatternSurfaceCooldown } from './pattern-surface-cooldown'
import { RecentActivityWindow } from './recent-activity-window'
import type {
  PatternNotificationService,
  RecentActivityPatternMatcher,
  RecentPatternActivity,
} from './types'

export class PersistedActivityPatternListener {
  readonly onActivityPersisted: ActivityPersistedListener = async (input) => {
    await this.handlePersistedActivity(input)
  }

  private readonly patternRepository: Pick<
    PatternRepository,
    'getAllPatterns' | 'getSightingsForPattern'
  >
  private readonly matcher: RecentActivityPatternMatcher
  private readonly notificationService: PatternNotificationService
  private readonly recentActivityWindow: RecentActivityWindow
  private readonly cooldown: PatternSurfaceCooldown
  private readonly now: () => number

  constructor(params: {
    patternRepository: Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>
    matcher: RecentActivityPatternMatcher
    notificationService: PatternNotificationService
    recentActivityWindow?: RecentActivityWindow
    cooldown?: PatternSurfaceCooldown
    now?: () => number
  }) {
    this.patternRepository = params.patternRepository
    this.matcher = params.matcher
    this.notificationService = params.notificationService
    this.recentActivityWindow = params.recentActivityWindow ?? new RecentActivityWindow()
    this.cooldown = params.cooldown ?? new PatternSurfaceCooldown()
    this.now = params.now ?? (() => Date.now())
  }

  async handlePersistedActivity(input: ActivityPersistedListenerInput): Promise<void> {
    this.recentActivityWindow.append(toRecentPatternActivity(input))

    const patterns = this.patternRepository.getAllPatterns()
    if (patterns.length === 0) {
      return
    }
    const sightings = patterns.flatMap((pattern) =>
      this.patternRepository.getSightingsForPattern(pattern.id, Math.max(pattern.sightingCount, 1)),
    )

    const now = this.now()
    const match = await this.matcher.match({
      recentActivities: this.recentActivityWindow.snapshot(),
      patterns,
      sightings,
      now,
    })

    if (match === null) {
      return
    }

    if (!this.cooldown.tryMarkSurfaced(match.patternId, now)) {
      return
    }

    await this.notificationService.notify(match)
  }
}

function toRecentPatternActivity(input: ActivityPersistedListenerInput): RecentPatternActivity {
  const { activity, extracted } = input
  return {
    id: activity.id,
    startTimestamp: activity.startTimestamp,
    endTimestamp: activity.endTimestamp,
    appName: extracted.appName,
    windowTitle: extracted.windowTitle,
    tld: extracted.tld ?? null,
    summary: extracted.summary,
    ocrText: extracted.ocrText,
  }
}
