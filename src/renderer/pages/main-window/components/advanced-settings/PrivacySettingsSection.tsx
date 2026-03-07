import { useEffect, useState } from 'react'
import { Label } from '@components/ui/label'
import { SectionToggle } from './SectionToggle'

interface PrivacySettingsSectionProps {
  open: boolean
  onToggle: () => void
  excludedApps: string[]
  onExcludedAppsCommit: (apps: string[]) => void
}

function parseExcludedAppsInput(input: string): string[] {
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
  onExcludedAppsCommit,
}: PrivacySettingsSectionProps): React.JSX.Element {
  const excludedAppsText = excludedApps.join('\n')
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(excludedAppsText)

  useEffect(() => {
    setExcludedAppsDraft(excludedAppsText)
  }, [excludedAppsText])

  return (
    <section>
      <SectionToggle label="Privacy" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-2">
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
              const parsed = parseExcludedAppsInput(event.target.value)
              setExcludedAppsDraft(parsed.join('\n'))
              onExcludedAppsCommit(parsed)
            }}
          />
          <p className="text-xs text-muted-foreground">
            Matching is case-insensitive. Use app names like <code>signal</code> or{' '}
            <code>whatsapp</code>.
          </p>
        </div>
      )}
    </section>
  )
}
