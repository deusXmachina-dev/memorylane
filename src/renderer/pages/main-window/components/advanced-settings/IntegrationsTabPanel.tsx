import type { MainWindowAPI } from '@types'
import { IntegrationsSection } from '../IntegrationsSection'

interface IntegrationsTabPanelProps {
  api: MainWindowAPI
}

export function IntegrationsTabPanel({ api }: IntegrationsTabPanelProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      <IntegrationsSection api={api} />
    </div>
  )
}
