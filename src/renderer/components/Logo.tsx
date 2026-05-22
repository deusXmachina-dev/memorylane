import * as React from 'react'
import logoUrl from '@/renderer/assets/logo.png'

interface LogoProps {
  size?: 'default' | 'sm' | 'lg'
  iconOnly?: boolean
}

export function Logo({ size = 'default', iconOnly = false }: LogoProps): React.JSX.Element {
  const sizes = {
    sm: { img: 24, text: 'text-base' },
    default: { img: 32, text: 'text-xl' },
    lg: { img: 40, text: 'text-2xl' },
  }

  const s = sizes[size]

  return (
    <div className="inline-flex items-center gap-2.5">
      <img
        src={logoUrl}
        alt="MemoryLane"
        width={s.img}
        height={s.img}
        className="invert dark:invert-0"
      />
      {!iconOnly && <span className={`${s.text} font-semibold tracking-tight`}>MemoryLane</span>}
    </div>
  )
}
