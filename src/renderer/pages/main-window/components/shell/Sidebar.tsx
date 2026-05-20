import * as React from 'react'
import { LayoutDashboard, ListVideo, Sparkles, Settings as SettingsIcon } from 'lucide-react'
import type { LlmHealthStatus, Vendor } from '@types'
import { CaptureControlSection } from '../CaptureControlSection'
import { SidebarNavItem } from './SidebarNavItem'
import { LlmStatusPanel } from './LlmStatusPanel'

export type MainSection = 'dashboard' | 'activities' | 'patterns' | 'settings'

interface SidebarProps {
  section: MainSection
  onSelectSection: (section: MainSection) => void
  capturing: boolean
  captureHotkeyLabel: string
  toggling: boolean
  onToggleCapture: () => void
  vendor: Vendor
  modelLabel: string | null
  llmHealth: LlmHealthStatus | null
  configured: boolean
  onOpenLlmSettings: () => void
}

export function Sidebar({
  section,
  onSelectSection,
  capturing,
  captureHotkeyLabel,
  toggling,
  onToggleCapture,
  vendor,
  modelLabel,
  llmHealth,
  configured,
  onOpenLlmSettings,
}: SidebarProps): React.JSX.Element {
  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="px-2 py-2">
        <div className="text-sm font-semibold tracking-tight">MemoryLane</div>
      </div>

      <nav className="flex flex-col gap-0.5">
        <SidebarNavItem
          icon={LayoutDashboard}
          label="Dashboard"
          active={section === 'dashboard'}
          onClick={() => onSelectSection('dashboard')}
        />
        <SidebarNavItem
          icon={ListVideo}
          label="Activities"
          active={section === 'activities'}
          onClick={() => onSelectSection('activities')}
        />
        <SidebarNavItem
          icon={Sparkles}
          label="Patterns"
          active={section === 'patterns'}
          onClick={() => onSelectSection('patterns')}
        />
        <SidebarNavItem
          icon={SettingsIcon}
          label="Settings"
          active={section === 'settings'}
          onClick={() => onSelectSection('settings')}
        />
      </nav>

      <div className="flex-1" />

      <LlmStatusPanel
        vendor={vendor}
        modelLabel={modelLabel}
        llmHealth={llmHealth}
        configured={configured}
        onClick={onOpenLlmSettings}
      />

      <CaptureControlSection
        capturing={capturing}
        captureHotkeyLabel={captureHotkeyLabel}
        toggling={toggling}
        onToggle={onToggleCapture}
      />
    </div>
  )
}
