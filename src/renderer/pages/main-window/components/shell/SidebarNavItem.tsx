import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/renderer/lib/utils'

interface SidebarNavItemProps {
  icon: LucideIcon
  label: string
  active: boolean
  collapsed?: boolean
  onClick: () => void
}

export function SidebarNavItem({
  icon: Icon,
  label,
  active,
  collapsed = false,
  onClick,
}: SidebarNavItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center rounded-md text-sm text-left transition-colors',
        collapsed ? 'justify-center w-full h-9' : 'gap-2.5 w-full px-3 h-9',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </button>
  )
}
