import * as React from 'react'

interface PageLayoutProps {
  title: string
  subtitle?: React.ReactNode
  headerBefore?: React.ReactNode
  /**
   * When true, the page becomes a full-height flex column and its children
   * container gets `flex-1 min-h-0`, so a child can flex to fill remaining
   * vertical space (e.g. the Patterns split-view).
   */
  fillHeight?: boolean
  /** Click handler on the title — used as the hidden Developer-mode tap target. */
  onTitleClick?: () => void
  children: React.ReactNode
}

export function PageLayout({
  title,
  subtitle,
  headerBefore,
  fillHeight,
  onTitleClick,
  children,
}: PageLayoutProps): React.JSX.Element {
  const root = fillHeight
    ? 'px-10 py-6 max-w-6xl mx-auto h-full flex flex-col gap-4'
    : 'px-10 py-6 max-w-6xl mx-auto space-y-4'
  return (
    <div className={root}>
      {headerBefore}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" onClick={onTitleClick}>
          {title}
        </h1>
        {subtitle && <div className="mt-1">{subtitle}</div>}
      </div>
      {fillHeight ? <div className="flex-1 min-h-0 flex flex-col gap-4">{children}</div> : children}
    </div>
  )
}
