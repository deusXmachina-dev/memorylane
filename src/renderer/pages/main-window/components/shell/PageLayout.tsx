import * as React from 'react'

interface PageLayoutProps {
  title: string
  subtitle?: React.ReactNode
  headerBefore?: React.ReactNode
  children: React.ReactNode
}

export function PageLayout({
  title,
  subtitle,
  headerBefore,
  children,
}: PageLayoutProps): React.JSX.Element {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      {headerBefore}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}
