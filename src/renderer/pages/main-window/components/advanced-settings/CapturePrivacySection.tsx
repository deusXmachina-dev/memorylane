import { ShieldCheck } from 'lucide-react'
import { Card, CardContent } from '@components/ui/card'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import type { CaptureSettings } from '@types'
import { ExclusionsManager } from './exclusions/ExclusionsManager'

interface CapturePrivacySectionProps {
  form: CaptureSettings
  onAutoStartEnabledChange: (enabled: boolean) => void
  onExcludePrivateBrowsingChange: (enabled: boolean) => void
  onExcludedRulesCommit: (rules: {
    excludedApps: string[]
    excludedWindowTitlePatterns: string[]
    excludedUrlPatterns: string[]
  }) => void
  onObserved: () => void
}

export function CapturePrivacySection({
  form,
  onAutoStartEnabledChange,
  onExcludePrivateBrowsingChange,
  onExcludedRulesCommit,
  onObserved,
}: CapturePrivacySectionProps): React.JSX.Element {
  const commitAppsChange = (nextApps: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: nextApps,
      excludedWindowTitlePatterns: form.excludedWindowTitlePatterns,
      excludedUrlPatterns: form.excludedUrlPatterns,
    })
  }

  const commitUrlsChange = (nextUrls: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: form.excludedApps,
      excludedWindowTitlePatterns: form.excludedWindowTitlePatterns,
      excludedUrlPatterns: nextUrls,
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-4 w-4" />
        Privacy rules
      </div>

      <Card>
        <CardContent className="space-y-5">
          <ExclusionsManager
            layout="stacked"
            excludedApps={form.excludedApps}
            excludedUrlPatterns={form.excludedUrlPatterns}
            onAppsChange={commitAppsChange}
            onUrlsChange={commitUrlsChange}
            onObserved={onObserved}
          />

          <div className="border-t border-border" />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground">
                Exclude private / incognito browsing
              </Label>
              <p className="text-xs text-muted-foreground">
                Any private browser window is skipped automatically.
              </p>
            </div>
            <Switch
              checked={form.excludePrivateBrowsing}
              onCheckedChange={onExcludePrivateBrowsingChange}
              aria-label="Exclude private browsing"
            />
          </div>

          <div className="border-t border-border" />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground">Launch at login</Label>
              <p className="text-xs text-muted-foreground">
                Start MemoryLane quietly when your Mac boots.
              </p>
            </div>
            <Switch
              checked={form.autoStartEnabled}
              onCheckedChange={onAutoStartEnabledChange}
              aria-label="Launch at login"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
