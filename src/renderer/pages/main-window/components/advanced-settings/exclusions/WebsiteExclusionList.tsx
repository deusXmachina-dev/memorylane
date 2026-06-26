import { useEffect, useMemo, useState } from 'react'
import { Globe } from 'lucide-react'
import type { SeenDomain } from '@types'
import { normalizeUrlPattern } from '@/shared/url-utils'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { ExclusionPicker, type ExclusionPickerItem } from './ExclusionPicker'

interface WebsiteExclusionListProps {
  excludedUrlPatterns: string[]
  onChange: (next: string[]) => void
  found?: string[]
  onDismissFound?: () => void
  managed?: string[]
}

export function WebsiteExclusionList({
  excludedUrlPatterns,
  onChange,
  found,
  onDismissFound,
  managed,
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

  // Search pool = already-blocked patterns ∪ seen domains, surfaced as full-URL
  // prefixes since URL exclusions now match "starts-with" against the full URL.
  const items = useMemo<ExclusionPickerItem[] | null>(() => {
    if (domains === null) return null
    const byToken = new Map<string, ExclusionPickerItem>()
    for (const e of excludedUrlPatterns) {
      const t = e.toLowerCase()
      byToken.set(t, { key: t, matchToken: t, label: t })
    }
    for (const d of domains) {
      const t = normalizeUrlPattern(d.tld.toLowerCase())
      if (!byToken.has(t)) byToken.set(t, { key: t, matchToken: t, label: t })
    }
    return [...byToken.values()]
  }, [domains, excludedUrlPatterns])

  return (
    <ExclusionPicker
      excluded={excludedUrlPatterns}
      onChange={(next) => onChange(next.map(normalizeUrlPattern))}
      items={items}
      found={found?.map(normalizeUrlPattern)}
      onDismissFound={onDismissFound}
      managed={managed}
      title="Websites"
      titleHelp={
        <>
          Wrap text in <code className="font-medium">*</code> to match it anywhere in a URL — e.g.{' '}
          <code className="font-medium">*bank.com*</code> blocks any address containing bank.com.
        </>
      }
      icon={Globe}
      placeholder="Type a URL to block (e.g. https://bank.com)"
      emptyPrimary="No websites blocked yet."
      emptySecondary="Type a URL above to block it. Use *text* to match anywhere."
    />
  )
}
