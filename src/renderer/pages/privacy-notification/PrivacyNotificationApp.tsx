import type * as React from 'react'
import logoImage from '@assets/tray-icon-full-size.png'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'

type PrivacyState = 'entering' | 'exiting'

interface PrivacyNotificationCopy {
  message: string
}

const copyByState: Record<PrivacyState, PrivacyNotificationCopy> = {
  entering: {
    message: 'Privacy mode on',
  },
  exiting: {
    message: 'Privacy mode off',
  },
}

function getPrivacyState(): PrivacyState {
  const state = new URLSearchParams(window.location.search).get('state')
  return state === 'exiting' ? 'exiting' : 'entering'
}

export function PrivacyNotificationApp(): React.JSX.Element {
  const privacyState = getPrivacyState()
  const copy = copyByState[privacyState]

  return (
    <main className="flex h-full w-full items-start justify-center overflow-hidden bg-transparent">
      <Card
        size="sm"
        className="group h-full w-full overflow-hidden rounded-none border border-border bg-background py-0 shadow-[0_10px_24px_rgba(15,23,42,0.14)]"
      >
        <CardContent className="relative flex h-full items-center gap-3 px-3.5">
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute top-2 right-2 h-5 w-5 rounded-none p-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            onClick={() => window.close()}
            aria-label="Dismiss"
          >
            <span className="text-[11px] leading-none">x</span>
          </Button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-muted/70">
            <img src={logoImage} alt="" className="h-4 w-4 object-contain dark:invert-0 invert" />
          </div>
          <p className="min-w-0 text-[12.5px] font-medium tracking-[0.01em] text-foreground">
            {copy.message}
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
