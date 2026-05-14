import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@components/ui/button'

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-ml-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </Button>
      {open && <div className="space-y-4">{children}</div>}
    </div>
  )
}
