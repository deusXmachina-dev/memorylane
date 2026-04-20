import { useEffect, useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import type { SeenDomain } from '@types'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { ExclusionPicker, type ExclusionPickerItem } from './ExclusionPicker'

interface WebsiteExclusionListProps {
  excludedUrlPatterns: string[]
  onChange: (next: string[]) => void
  found?: string[]
  onDismissFound?: () => void
}

function isWildcardPattern(value: string): boolean {
  return value.includes('*') || value.includes('?')
}

export function WebsiteExclusionList({
  excludedUrlPatterns,
  onChange,
  found,
  onDismissFound,
}: WebsiteExclusionListProps): React.JSX.Element {
  const api = useMainWindowAPI()
  const [domains, setDomains] = useState<SeenDomain[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listSeenDomains()
      .then((result) => {
        if (cancelled) return
        setDomains(result)
      })
      .catch(() => {
        if (cancelled) return
        setDomains([])
      })
    return () => {
      cancelled = true
    }
  }, [api])

  const nonLegacyExcluded = useMemo(
    () => excludedUrlPatterns.filter((e) => !isWildcardPattern(e)),
    [excludedUrlPatterns],
  )

  const legacyEntries = useMemo(
    () => excludedUrlPatterns.filter(isWildcardPattern),
    [excludedUrlPatterns],
  )

  // Search pool = already-blocked domains ∪ seen domains from activity history.
  const items = useMemo<ExclusionPickerItem[] | null>(() => {
    if (domains === null) return null
    const byToken = new Map<string, ExclusionPickerItem>()
    for (const e of nonLegacyExcluded) {
      const t = e.toLowerCase()
      byToken.set(t, { key: t, matchToken: t, label: t })
    }
    for (const d of domains) {
      const t = d.tld.toLowerCase()
      if (!byToken.has(t)) byToken.set(t, { key: t, matchToken: t, label: t })
    }
    return [...byToken.values()]
  }, [domains, nonLegacyExcluded])

  return (
    <ExclusionPicker
      excluded={excludedUrlPatterns}
      onChange={onChange}
      items={items}
      found={found}
      onDismissFound={onDismissFound}
      legacyEntries={legacyEntries}
      legacyTitle="Custom patterns"
      emptyViewMode="excluded-only"
      icon={Globe}
      placeholder="Search or type a domain to block (e.g. bank.com)"
      loadingLabel="Loading websites..."
      emptyLabel="No websites blocked yet. Type a domain above to block it."
    />
  )
}
