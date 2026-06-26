import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppWindow } from 'lucide-react'
import type { InstalledApp } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { ExclusionPicker, type ExclusionPickerItem } from './ExclusionPicker'

interface AppExclusionListProps {
  excludedApps: string[]
  onChange: (next: string[]) => void
  found?: string[]
  onDismissFound?: () => void
  managed?: string[]
}

export function AppExclusionList({
  excludedApps,
  onChange,
  found,
  onDismissFound,
  managed,
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

  // Managed entries arrive as raw tokens (often full bundle ids like
  // `com.google.chrome`). Resolve them to an installed app's display name,
  // falling back to the bundle id's last segment — same candidate order the
  // capture matcher uses — then to the raw entry.
  const resolveManagedLabel = useCallback(
    (entry: string): string => {
      const normalized = entry.toLowerCase()
      const direct = apps?.find((a) => a.matchToken === normalized)
      if (direct) return direct.displayName
      const lastSegment = normalized.split('.').pop()
      if (lastSegment && lastSegment !== normalized) {
        const bySegment = apps?.find((a) => a.matchToken === lastSegment)
        if (bySegment) return bySegment.displayName
      }
      return entry
    },
    [apps],
  )

  return (
    <ExclusionPicker
      excluded={excludedApps}
      onChange={onChange}
      items={items}
      found={found}
      onDismissFound={onDismissFound}
      managed={managed}
      resolveManagedLabel={resolveManagedLabel}
      title="Apps"
      icon={AppWindow}
      placeholder="Search or type an app name (e.g. signal)"
      emptyPrimary="No apps blocked yet."
      emptySecondary="Type a name above to block it."
    />
  )
}
