import * as React from 'react'
import logoImage from '@assets/tray-icon-full-size.png'
import { Button } from '@components/ui/button'

interface LogoProps {
  onSettingsClick: () => void
}

export function Logo({ onSettingsClick }: LogoProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <img src={logoImage} alt="MemoryLane" className="w-6 h-6 dark:invert-0 invert" />
        <h1 className="text-sm font-semibold tracking-tight">MemoryLane</h1>
      </div>
      <Button variant="ghost" size="sm" onClick={onSettingsClick}>
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
  )
}
