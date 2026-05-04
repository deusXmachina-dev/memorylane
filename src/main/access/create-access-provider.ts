import type { AppEdition } from '../../shared/edition'
import type { DeviceIdentity } from '../settings/device-identity'
import type { EnterpriseLicenseConfig } from '../settings/enterprise-license-config'
import { CustomerAccessProvider } from './customer-access-provider'
import { EnterpriseAccessProvider } from './enterprise-access-provider'
import type { AccessProvider } from './types'

export function createAccessProvider(
  edition: AppEdition,
  deviceIdentity: DeviceIdentity,
  licenseConfig?: EnterpriseLicenseConfig,
): AccessProvider {
  return edition === 'enterprise'
    ? new EnterpriseAccessProvider(deviceIdentity, licenseConfig)
    : new CustomerAccessProvider(deviceIdentity)
}
