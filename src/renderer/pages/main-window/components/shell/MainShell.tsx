import * as React from 'react'
import { cn } from '@/renderer/lib/utils'

interface MainShellProps {
  sidebar: React.ReactNode
  sidebarCollapsed?: boolean
  children: React.ReactNode
}

export function MainShell({
  sidebar,
  sidebarCollapsed = false,
  children,
}: MainShellProps): React.JSX.Element {
  return (
    <div className="h-screen flex bg-background antialiased select-none">
      <aside
        className={cn(
          'shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-200',
          sidebarCollapsed ? 'w-16' : 'w-56',
        )}
      >
        {sidebar}
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
