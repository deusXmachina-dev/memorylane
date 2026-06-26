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
  managed?: string[]
}

// URL exclusions match "starts-with" against the full URL, so a bare host can't
// match. Prepend https:// to a scheme-less, wildcard-free entry so it forms a
// valid prefix; leave full URLs and `*`/`?` wildcard patterns untouched.
function normalizeUrlInput(value: string): string {
  const v = value.trim()
  if (!v || /[*?]/.test(v) || v.includes('://')) return v
  return `https://${v}`
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
      const t = normalizeUrlInput(d.tld.toLowerCase())
      if (!byToken.has(t)) byToken.set(t, { key: t, matchToken: t, label: t })
    }
    return [...byToken.values()]
  }, [domains, excludedUrlPatterns])

  return (
    <ExclusionPicker
      excluded={excludedUrlPatterns}
      onChange={(next) => onChange(next.map(normalizeUrlInput))}
      items={items}
      found={found?.map(normalizeUrlInput)}
      onDismissFound={onDismissFound}
      managed={managed}
      title="Websites"
      icon={Globe}
      placeholder="Type a URL to block (e.g. https://bank.com)"
      emptyPrimary="No websites blocked yet."
      emptySecondary="Type a URL above to block it. Use *text* to match anywhere."
    />
  )
}
