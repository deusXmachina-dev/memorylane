import type { McpIntegration } from './types'
import {
  registerWithClaudeDesktop,
  isMcpAddedToClaudeDesktop,
  migrateClaudeDesktop,
} from './claude-desktop'
import { registerWithCursor, isMcpAddedToCursor, migrateCursor } from './cursor'
import { registerWithClaudeCode, isMcpAddedToClaudeCode, migrateClaudeCode } from './claude-code'

export type { McpIntegration } from './types'

export const integrations: McpIntegration[] = [
  {
    name: 'claudeDesktop',
    label: 'Claude Desktop',
    register: registerWithClaudeDesktop,
    isMcpAdded: isMcpAddedToClaudeDesktop,
  },
  {
    name: 'cursor',
    label: 'Cursor',
    register: registerWithCursor,
    isMcpAdded: isMcpAddedToCursor,
  },
  {
    name: 'claudeCode',
    label: 'Claude Code',
    register: registerWithClaudeCode,
    isMcpAdded: isMcpAddedToClaudeCode,
  },
]

/**
 * Migrate old Electron-based MCP entries to CLI-based entries.
 * Called on app startup — best-effort, no errors thrown.
 */
export function migrateOldMcpEntries(): void {
  migrateClaudeDesktop()
  migrateClaudeCode()
  migrateCursor()
}
