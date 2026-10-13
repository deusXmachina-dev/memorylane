import type { PresenceProbe } from './event-capturer'

export const away: PresenceProbe = { isPresent: () => false, lastInputAt: () => 0 }
