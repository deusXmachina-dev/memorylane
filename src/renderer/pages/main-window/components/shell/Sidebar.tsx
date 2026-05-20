import * as React from 'react'
import {
  LayoutDashboard,
  ListVideo,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Settings as SettingsIcon,
} from 'lucide-react'
import { cn } from '@/renderer/lib/utils'
import type { LlmHealthStatus, Vendor } from '@types'
import { CaptureControlSection } from '../CaptureControlSection'
import { SidebarNavItem } from './SidebarNavItem'
import { LlmStatusPanel } from './LlmStatusPanel'

export type MainSection = 'dashboard' | 'activities' | 'patterns' | 'settings'

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
  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
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
      </div>

      <nav className="flex flex-col gap-0.5">
        <SidebarNavItem
          icon={LayoutDashboard}
          label="Dashboard"
          active={section === 'dashboard'}
          collapsed={collapsed}
          onClick={() => onSelectSection('dashboard')}
        />
        <SidebarNavItem
          icon={ListVideo}
          label="Activities"
          active={section === 'activities'}
          collapsed={collapsed}
          onClick={() => onSelectSection('activities')}
        />
        <SidebarNavItem
          icon={Sparkles}
          label="Patterns"
          active={section === 'patterns'}
          collapsed={collapsed}
          onClick={() => onSelectSection('patterns')}
        />
        <SidebarNavItem
          icon={SettingsIcon}
          label="Settings"
          active={section === 'settings'}
          collapsed={collapsed}
          onClick={() => onSelectSection('settings')}
        />
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
