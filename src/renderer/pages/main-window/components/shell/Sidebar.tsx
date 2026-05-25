import * as React from 'react'
import {
  ListVideo,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/renderer/lib/utils'
import type { LlmHealthStatus, Vendor } from '@types'
import { CaptureControlSection } from '../CaptureControlSection'
import { SidebarNavItem } from './SidebarNavItem'
import { LlmStatusPanel } from './LlmStatusPanel'
import { Logo } from '@/renderer/components/Logo'

export type MainSection = 'activities' | 'patterns' | 'settings'

const NAV_ITEMS: { id: MainSection; label: string; icon: LucideIcon }[] = [
  { id: 'activities', label: 'Activities', icon: ListVideo },
  { id: 'patterns', label: 'Patterns', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

interface SidebarProps {
  section: MainSection
  onSelectSection: (section: MainSection) => void
  capturing: boolean
  toggling: boolean
  onToggleCapture: () => void
  vendor: Vendor
  llmHealth: LlmHealthStatus | null
  configured: boolean
  onOpenLlmSettings: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function Sidebar({
  section,
  onSelectSection,
  capturing,
  toggling,
  onToggleCapture,
  vendor,
  llmHealth,
  configured,
  onOpenLlmSettings,
  collapsed,
  onToggleCollapsed,
}: SidebarProps): React.JSX.Element {
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toggleButton = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'flex items-center justify-center size-8 rounded-md',
        'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'transition-colors',
      )}
    >
      <CollapseIcon className="size-4" />
    </button>
  )
  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {collapsed ? (
        <div className="flex flex-col items-center gap-1">
          <Logo size="sm" iconOnly />
          {toggleButton}
        </div>
      ) : (
        <div className="flex items-center justify-between pl-1.75">
          <Logo size="sm" />
          {toggleButton}
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(({ id, label, icon }) => (
          <SidebarNavItem
            key={id}
            icon={icon}
            label={label}
            active={section === id}
            collapsed={collapsed}
            onClick={() => onSelectSection(id)}
          />
        ))}
      </nav>

      <div className="flex-1" />

      <LlmStatusPanel
        vendor={vendor}
        llmHealth={llmHealth}
        configured={configured}
        collapsed={collapsed}
        onClick={onOpenLlmSettings}
      />

      <CaptureControlSection
        capturing={capturing}
        toggling={toggling}
        onToggle={onToggleCapture}
        compact={collapsed}
      />
    </div>
  )
}
