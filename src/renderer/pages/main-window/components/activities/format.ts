export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function formatDayHeading(ms: number): string {
  const today = startOfLocalDay(Date.now())
  const yesterday = today - 24 * 60 * 60 * 1000
  const thisDayStart = startOfLocalDay(ms)
  if (thisDayStart === today) return 'Today'
  if (thisDayStart === yesterday) return 'Yesterday'
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000))
  if (totalMinutes < 1) return '<1m'
  if (totalMinutes < 60) return `${totalMinutes}m`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function formatShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function formatMinutes(min: number): string {
  if (min >= 60) return `${(min / 60).toFixed(1)}h`
  return `${Math.max(1, Math.round(min))}m`
}

export function formatFrequency(perWeek: number): string {
  if (perWeek <= 0) return ''
  if (perWeek >= 0.95) return `~${Math.round(perWeek)}×/wk`
  const perMonth = perWeek * (30.44 / 7)
  return perMonth >= 0.95 ? `~${Math.round(perMonth)}×/mo` : '<1×/mo'
}

export function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return 'never'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${Math.max(0, minutes)} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
