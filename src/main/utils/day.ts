export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function getDayBoundaries(daysBack: number): {
  start: number
  end: number
  label: string
} {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  const start = day.getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - 1
  const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return { start, end, label }
}
