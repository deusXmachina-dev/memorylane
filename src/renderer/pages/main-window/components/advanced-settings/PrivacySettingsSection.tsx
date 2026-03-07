import { useEffect, useRef, useState } from 'react'
import { Button } from '@components/ui/button'
import { Label } from '@components/ui/label'
import { SectionToggle } from './SectionToggle'

interface PrivacySettingsSectionProps {
  open: boolean
  onToggle: () => void
  excludePrivateBrowsing: boolean
  excludedApps: string[]
  excludedWindowTitlePatterns: string[]
  excludedUrlPatterns: string[]
  onExcludePrivateBrowsingChange: (enabled: boolean) => void
  onExcludedRulesCommit: (rules: {
    excludedApps: string[]
    excludedWindowTitlePatterns: string[]
    excludedUrlPatterns: string[]
  }) => void
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
  excludePrivateBrowsing,
  excludedApps,
  excludedWindowTitlePatterns,
  excludedUrlPatterns,
  onExcludePrivateBrowsingChange,
  onExcludedRulesCommit,
}: PrivacySettingsSectionProps): React.JSX.Element {
  const excludedAppsText = excludedApps.join('\n')
  const excludedWindowTitlePatternsText = excludedWindowTitlePatterns.join('\n')
  const excludedUrlPatternsText = excludedUrlPatterns.join('\n')
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(excludedAppsText)
  const [excludedWindowTitlePatternsDraft, setExcludedWindowTitlePatternsDraft] = useState(
    excludedWindowTitlePatternsText,
  )
  const [excludedUrlPatternsDraft, setExcludedUrlPatternsDraft] = useState(excludedUrlPatternsText)
  const [advancedOpen, setAdvancedOpen] = useState(
    excludedWindowTitlePatterns.length > 0 || excludedUrlPatterns.length > 0,
  )
  const [hasPendingChanges, setHasPendingChanges] = useState(false)
  const previousOpenRef = useRef(open)

  useEffect(() => {
    setExcludedAppsDraft(excludedAppsText)
  }, [excludedAppsText])
  useEffect(() => {
    setExcludedWindowTitlePatternsDraft(excludedWindowTitlePatternsText)
  }, [excludedWindowTitlePatternsText])
  useEffect(() => {
    setExcludedUrlPatternsDraft(excludedUrlPatternsText)
  }, [excludedUrlPatternsText])
  useEffect(() => {
    if (excludedWindowTitlePatterns.length > 0 || excludedUrlPatterns.length > 0) {
      setAdvancedOpen(true)
    }
  }, [excludedWindowTitlePatterns, excludedUrlPatterns])

  const commitDrafts = (): void => {
    const nextExcludedApps = parseInputList(excludedAppsDraft)
    const nextExcludedWindowTitlePatterns = parseInputList(excludedWindowTitlePatternsDraft)
    const nextExcludedUrlPatterns = parseInputList(excludedUrlPatternsDraft)

    setExcludedAppsDraft(nextExcludedApps.join('\n'))
    setExcludedWindowTitlePatternsDraft(nextExcludedWindowTitlePatterns.join('\n'))
    setExcludedUrlPatternsDraft(nextExcludedUrlPatterns.join('\n'))
    setHasPendingChanges(false)

    onExcludedRulesCommit({
      excludedApps: nextExcludedApps,
      excludedWindowTitlePatterns: nextExcludedWindowTitlePatterns,
      excludedUrlPatterns: nextExcludedUrlPatterns,
    })
  }

  useEffect(() => {
    if (previousOpenRef.current && !open && hasPendingChanges) {
      commitDrafts()
    }
    previousOpenRef.current = open
  }, [open, hasPendingChanges])

  useEffect(() => {
    return () => {
      if (hasPendingChanges) {
        commitDrafts()
      }
    }
  }, [
    hasPendingChanges,
    excludedAppsDraft,
    excludedWindowTitlePatternsDraft,
    excludedUrlPatternsDraft,
  ])

  return (
    <section>
      <SectionToggle label="Privacy" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs text-muted-foreground">Exclude Private Browsing</Label>
              <div
                role="group"
                aria-label="Exclude Private Browsing"
                className="grid shrink-0 grid-cols-2 gap-2"
              >
                <Button
                  variant={excludePrivateBrowsing ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={excludePrivateBrowsing}
                  onClick={() => onExcludePrivateBrowsingChange(true)}
                >
                  On
                </Button>
                <Button
                  variant={!excludePrivateBrowsing ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={!excludePrivateBrowsing}
                  onClick={() => onExcludePrivateBrowsingChange(false)}
                >
                  Off
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excluded Apps (one per line)</Label>
            <textarea
              value={excludedAppsDraft}
              rows={4}
              className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
              placeholder={`keychain access\nsignal\nwhatsapp`}
              onChange={(event) => {
                setExcludedAppsDraft(event.target.value)
                setHasPendingChanges(true)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Matching is case-insensitive. Use app names like <code>signal</code> or{' '}
              <code>whatsapp</code>.
            </p>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              {advancedOpen ? 'Hide advanced wildcard rules' : 'Show advanced wildcard rules'}
            </button>
          </div>

          {advancedOpen && (
            <>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Excluded Window Titles (wildcards, one per line)
                </Label>
                <textarea
                  value={excludedWindowTitlePatternsDraft}
                  rows={3}
                  className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
                  placeholder={`*bank statement*\n*lab results*`}
                  onChange={(event) => {
                    setExcludedWindowTitlePatternsDraft(event.target.value)
                    setHasPendingChanges(true)
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Excluded URLs (wildcards, one per line)
                </Label>
                <textarea
                  value={excludedUrlPatternsDraft}
                  rows={3}
                  className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
                  placeholder={`*://*.bank.com/*\n*://mychart.*/*`}
                  onChange={(event) => {
                    setExcludedUrlPatternsDraft(event.target.value)
                    setHasPendingChanges(true)
                  }}
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Patterns are case-insensitive. Use <code>*</code> for any text and <code>?</code> for
              one character.
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={commitDrafts}>
              Save privacy rules
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
