import { useState } from 'react'
import { ChevronRight } from 'lucide-react'

interface SettingsDisclosureProps {
  label: string
  defaultOpen?: boolean
  children: React.ReactNode
}

export function SettingsDisclosure({
  label,
  defaultOpen = false,
  children,
}: SettingsDisclosureProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  )
}
