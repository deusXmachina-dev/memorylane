import type { McpIntegration } from './types'
import { registerWithClaudeDesktop, getClaudeDesktopStatus } from './claude-desktop'
import { registerWithCursor, getCursorStatus } from './cursor'
import { registerWithClaudeCode, getClaudeCodeStatus } from './claude-code'

export type { McpIntegration } from './types'

export const integrations: McpIntegration[] = [
  {
    name: 'claudeDesktop',
    label: 'Claude Desktop',
    register: registerWithClaudeDesktop,
    getStatus: getClaudeDesktopStatus,
  },
  {
    name: 'cursor',
    label: 'Cursor',
    register: registerWithCursor,
    getStatus: getCursorStatus,
  },
  {
    name: 'claudeCode',
    label: 'Claude Code',
    register: registerWithClaudeCode,
    getStatus: getClaudeCodeStatus,
  },
]
