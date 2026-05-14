import type { MainWindowAPI } from '@types'
import { IntegrationsSection } from '../IntegrationsSection'

interface IntegrationsTabPanelProps {
  api: MainWindowAPI
}

export function IntegrationsTabPanel({ api }: IntegrationsTabPanelProps): React.JSX.Element {
  return (
    <section>
      <IntegrationsSection api={api} />
    </section>
  )
}
