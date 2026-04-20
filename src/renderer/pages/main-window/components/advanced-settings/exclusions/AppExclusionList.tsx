import { useEffect, useMemo, useState } from 'react'
import type { InstalledApp } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { ExclusionPicker, type ExclusionPickerItem } from './ExclusionPicker'

interface AppExclusionListProps {
  excludedApps: string[]
  onChange: (next: string[]) => void
  found?: string[]
  onDismissFound?: () => void
}

export function AppExclusionList({
  excludedApps,
  onChange,
  found,
  onDismissFound,
}: AppExclusionListProps): React.JSX.Element {
  const api = useMainWindowAPI()
  const [apps, setApps] = useState<InstalledApp[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listInstalledApps()
      .then((result) => {
        if (cancelled) return
        setApps(result)
      })
      .catch(() => {
        if (cancelled) return
        setApps([])
      })
    return () => {
      cancelled = true
    }
  }, [api])

  // Pool = installed apps ∪ excluded tokens not in installed list (so manually-added
  // entries render as regular toggle rows alongside installed apps).
  const items = useMemo<ExclusionPickerItem[] | null>(() => {
    if (apps === null) return null
    const byToken = new Map<string, ExclusionPickerItem>()
    for (const a of apps) {
      byToken.set(a.matchToken, {
        key: a.matchToken,
        matchToken: a.matchToken,
        label: a.displayName,
      })
    }
    for (const e of excludedApps) {
      const t = e.toLowerCase()
      if (!byToken.has(t)) byToken.set(t, { key: t, matchToken: t, label: t })
    }
    return [...byToken.values()]
  }, [apps, excludedApps])

  return (
    <ExclusionPicker
      excluded={excludedApps}
      onChange={onChange}
      items={items}
      found={found}
      onDismissFound={onDismissFound}
      legacyEntries={[]}
      legacyTitle=""
      emptyViewMode="excluded-only"
      placeholder="Search or type an app name to block (e.g. signal)"
      loadingLabel="Loading applications..."
      emptyLabel="No apps blocked yet. Type a name above to block it."
    />
  )
}
