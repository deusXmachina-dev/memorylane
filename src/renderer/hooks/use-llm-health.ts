import { useCallback, useEffect, useState } from 'react'
import { LLM_HEALTH_CONFIG } from '@constants'
import type { LlmHealthStatus, MainWindowAPI } from '@types'

interface UseLlmHealthParams {
  api: MainWindowAPI
  enabled: boolean
}

export function useLlmHealth({ api, enabled }: UseLlmHealthParams): {
  llmHealth: LlmHealthStatus | null
  refreshLlmHealth: () => Promise<void>
} {
  const [llmHealth, setLlmHealth] = useState<LlmHealthStatus | null>(null)

  const refreshLlmHealth = useCallback(async (): Promise<void> => {
    try {
      const status = await api.getLlmHealth()
      setLlmHealth(status)
    } catch {
      // Silently handle error
    }
  }, [api])

  useEffect(() => {
    if (!enabled) return
    void refreshLlmHealth()
  }, [enabled, refreshLlmHealth])

  useEffect(() => {
    if (!enabled) return

    const intervalId = window.setInterval(() => {
      void refreshLlmHealth()
    }, LLM_HEALTH_CONFIG.STATUS_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [enabled, refreshLlmHealth])

  // Re-probe only while the connection is known to be failing, at a slow
  // cadence, to detect recovery. We no longer probe on focus or a resting
  // `unknown` state — health is driven by real inference traffic (DEU-176).
  useEffect(() => {
    if (!enabled || llmHealth?.state !== 'failing') return

    const probe = (): void => {
      void api.testLlmConnection().finally(() => {
        void refreshLlmHealth()
      })
    }
    const intervalId = window.setInterval(probe, LLM_HEALTH_CONFIG.RECOVERY_PROBE_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [api, enabled, llmHealth?.state, refreshLlmHealth])

  return { llmHealth, refreshLlmHealth }
}
