/**
 * CLI plumbing for the InferenceProvider.
 *
 * Mirrors what the Electron main process does at startup: load
 * VendorCredentialsManager + CaptureSettingsManager from the on-disk
 * userData dir, then construct an InferenceProvider against the active
 * vendor.
 *
 * Differences from the app:
 * - No Electron app context, so `safeStorage` is unavailable. We pass a
 *   stub that reports encryption-unavailable, which makes
 *   VendorCredentialsManager skip the encrypted blob and fall through to
 *   environment variables for the api key. The cleartext `baseURL` (used
 *   by openai-compatible) still gets read from disk.
 * - The api key must come from an env var or a CLI flag.
 */

import * as path from 'path'
import { CaptureSettingsManager } from '../src/main/settings/capture-settings-manager'
import { VendorCredentialsManager } from '../src/main/settings/vendor-credentials-manager'
import { InferenceProviderImpl } from '../src/main/llm'
import type { InferenceProvider } from '../src/main/llm'
import { getAppDataPath } from '../src/main/paths'
import { VENDORS, type Vendor } from '../src/shared/types'

const DEFAULT_API_KEY_ENV: Record<Vendor, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  google: 'GOOGLE_VERTEX_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
}

export interface CliInferenceProviderOptions {
  /** Override userData dir (defaults to the app's real path). */
  userDataPath?: string
  /** API key supplied via CLI flag — wins over env vars. */
  apiKey?: string
  /**
   * Override the active vendor from settings (e.g. test against
   * openai-compatible without changing the GUI). Must be one of `VENDORS`.
   */
  vendorOverride?: string
}

export interface CliInferenceProviderHandle {
  provider: InferenceProvider
  vendor: Vendor
  /** `patternDetectionModel` from settings; empty string if unset. */
  patternDetectionModel: string
  /** `semanticSnapshotModel` from settings; empty string if unset. */
  semanticSnapshotModel: string
  baseURL: string | null
}

export function loadCliInferenceProvider(
  options: CliInferenceProviderOptions = {},
): CliInferenceProviderHandle {
  const userData = options.userDataPath ?? getAppDataPath()

  const captureSettings = new CaptureSettingsManager(path.join(userData, 'capture-settings.json'))
  const settings = captureSettings.get()

  let vendor: Vendor
  if (options.vendorOverride) {
    if (!(VENDORS as readonly string[]).includes(options.vendorOverride)) {
      throw new Error(
        `Unknown vendor "${options.vendorOverride}". Expected one of: ${VENDORS.join(', ')}`,
      )
    }
    vendor = options.vendorOverride as Vendor
  } else {
    vendor = settings.activeVendor
  }
  const vendorSelection = settings.modelsByVendor[vendor]

  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.apiKey) {
    env[DEFAULT_API_KEY_ENV[vendor]] = options.apiKey
  }

  const credentials = new VendorCredentialsManager({
    configPath: path.join(userData, 'vendor-credentials.json'),
    legacyApiKeyConfigPath: path.join(userData, 'secure-config.json'),
    legacyCustomEndpointConfigPath: path.join(userData, 'custom-endpoint.json'),
    safeStorage: {
      // CLI cannot decrypt the stored key (no Electron app context). Force
      // the manager to fall through to env-var resolution.
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
    env,
  })

  const status = credentials.getStatus(vendor)
  if (!status.hasKey) {
    const envName = DEFAULT_API_KEY_ENV[vendor]
    throw new Error(
      `No credentials for active vendor "${vendor}". ` +
        `Set ${envName} or pass --api-key. ` +
        (vendor === 'openai-compatible'
          ? `For Ollama, ensure ${userData}/vendor-credentials.json has the openai-compatible baseURL set via the GUI first.`
          : ''),
    )
  }

  const provider = new InferenceProviderImpl({
    credentials,
    getActiveVendor: () => vendor,
  })

  // When the user overrides the vendor, prefer the per-vendor remembered
  // selection over the active vendor's flat model fields — those still
  // belong to whatever vendor is active in the GUI.
  const patternDetectionModel = options.vendorOverride
    ? (vendorSelection?.patternDetectionModel ?? '')
    : settings.patternDetectionModel
  const semanticSnapshotModel = options.vendorOverride
    ? (vendorSelection?.semanticSnapshotModel ?? '')
    : settings.semanticSnapshotModel

  return {
    provider,
    vendor,
    patternDetectionModel,
    semanticSnapshotModel,
    baseURL: status.baseURL,
  }
}
