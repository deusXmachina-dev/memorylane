import { useEffect, useState } from 'react'
import { Label } from '@components/ui/label'
import { SectionToggle } from './SectionToggle'

interface PrivacySettingsSectionProps {
  open: boolean
  onToggle: () => void
  excludedApps: string[]
  excludedWindowTitlePatterns: string[]
  excludedUrlPatterns: string[]
  onExcludedAppsCommit: (apps: string[]) => void
  onExcludedWindowTitlePatternsCommit: (patterns: string[]) => void
  onExcludedUrlPatternsCommit: (patterns: string[]) => void
}

function parseInputList(input: string): string[] {
  const seen = new Set<string>()
  const parsed: string[] = []

  for (const line of input.split('\n')) {
    const value = line.trim()
    if (value.length === 0) continue
    const dedupeKey = value.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    parsed.push(value)
  }

  return parsed
}

export function PrivacySettingsSection({
  open,
  onToggle,
  excludedApps,
  excludedWindowTitlePatterns,
  excludedUrlPatterns,
  onExcludedAppsCommit,
  onExcludedWindowTitlePatternsCommit,
  onExcludedUrlPatternsCommit,
}: PrivacySettingsSectionProps): React.JSX.Element {
  const excludedAppsText = excludedApps.join('\n')
  const excludedWindowTitlePatternsText = excludedWindowTitlePatterns.join('\n')
  const excludedUrlPatternsText = excludedUrlPatterns.join('\n')
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(excludedAppsText)
  const [excludedWindowTitlePatternsDraft, setExcludedWindowTitlePatternsDraft] = useState(
    excludedWindowTitlePatternsText,
  )
  const [excludedUrlPatternsDraft, setExcludedUrlPatternsDraft] = useState(excludedUrlPatternsText)

  useEffect(() => {
    setExcludedAppsDraft(excludedAppsText)
  }, [excludedAppsText])
  useEffect(() => {
    setExcludedWindowTitlePatternsDraft(excludedWindowTitlePatternsText)
  }, [excludedWindowTitlePatternsText])
  useEffect(() => {
    setExcludedUrlPatternsDraft(excludedUrlPatternsText)
  }, [excludedUrlPatternsText])

  return (
    <section>
      <SectionToggle label="Privacy" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excluded Apps (one per line)</Label>
            <textarea
              value={excludedAppsDraft}
              rows={4}
              className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
              placeholder={`keychain access\nsignal\nwhatsapp`}
              onChange={(event) => {
                setExcludedAppsDraft(event.target.value)
              }}
              onBlur={(event) => {
                const parsed = parseInputList(event.target.value)
                setExcludedAppsDraft(parsed.join('\n'))
                onExcludedAppsCommit(parsed)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Matching is case-insensitive. Use app names like <code>signal</code> or{' '}
              <code>whatsapp</code>.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Excluded Window Titles (wildcards, one per line)
            </Label>
            <textarea
              value={excludedWindowTitlePatternsDraft}
              rows={4}
              className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
              placeholder={`*incognito*\n*private browsing*`}
              onChange={(event) => {
                setExcludedWindowTitlePatternsDraft(event.target.value)
              }}
              onBlur={(event) => {
                const parsed = parseInputList(event.target.value)
                setExcludedWindowTitlePatternsDraft(parsed.join('\n'))
                onExcludedWindowTitlePatternsCommit(parsed)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Use <code>*</code> for any text and <code>?</code> for one character.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Excluded URLs (wildcards, one per line)
            </Label>
            <textarea
              value={excludedUrlPatternsDraft}
              rows={4}
              className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
              placeholder={`*://mail.google.com/*\n*://*.bank.com/*`}
              onChange={(event) => {
                setExcludedUrlPatternsDraft(event.target.value)
              }}
              onBlur={(event) => {
                const parsed = parseInputList(event.target.value)
                setExcludedUrlPatternsDraft(parsed.join('\n'))
                onExcludedUrlPatternsCommit(parsed)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Patterns are case-insensitive and matched against the full URL.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
