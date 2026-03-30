export type AppEdition = 'customer' | 'enterprise'

export interface AppEditionConfig {
  edition: AppEdition
}

export const DEFAULT_EDITION: AppEdition = 'customer'

export function parseEdition(value: string | undefined): AppEdition {
  return value === 'enterprise' ? 'enterprise' : DEFAULT_EDITION
}
