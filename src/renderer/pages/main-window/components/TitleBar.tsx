import * as React from 'react'
import { Button } from '@components/ui/button'

interface TitleBarProps {
  onSettingsClick?: () => void
}

export function TitleBar({ onSettingsClick }: TitleBarProps): React.JSX.Element {
  return (
    <div
      className="h-11 flex items-center justify-center relative select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <h1 className="text-sm font-semibold tracking-tight">MemoryLane</h1>
      {onSettingsClick ? (
        <div
          className="absolute right-2 top-1/2 -translate-y-1/2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button variant="ghost" size="sm" onClick={onSettingsClick} aria-label="Settings">
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
