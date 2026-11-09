import type { McpIntegration } from './types'
import { registerWithClaudeDesktop, getClaudeDesktopStatus } from './claude-desktop'
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
    name: 'claudeCode',
    label: 'Claude Code',
    register: registerWithClaudeCode,
    getStatus: getClaudeCodeStatus,
  },
]
