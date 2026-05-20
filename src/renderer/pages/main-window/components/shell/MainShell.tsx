import * as React from 'react'

interface MainShellProps {
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function MainShell({ sidebar, children }: MainShellProps): React.JSX.Element {
  return (
    <div className="h-screen flex bg-background antialiased select-none">
      <aside className="w-56 shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        {sidebar}
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
