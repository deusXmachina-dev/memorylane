import type { McpEntryStatus } from '../../shared/types'

export interface McpIntegration {
  name: string
  label: string
  register(): Promise<boolean>
  getStatus(): McpEntryStatus
}
