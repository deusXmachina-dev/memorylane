import { Agent, setGlobalDispatcher } from 'undici'
import { TRANSPORT_TIMEOUT_MS } from '../../shared/constants'

/**
 * undici defaults headersTimeout and bodyTimeout to 300s and applies them
 * underneath fetch(), where no SDK option can reach — a local model still
 * generating after five minutes was killed regardless of the configured
 * deadline (issue #268). Raised to a backstop that outlives any deadline the
 * app can be configured with. connectTimeout keeps its default so an
 * unreachable host still fails fast.
 */
export function configureHttpTransport(): void {
  setGlobalDispatcher(
    new Agent({ headersTimeout: TRANSPORT_TIMEOUT_MS, bodyTimeout: TRANSPORT_TIMEOUT_MS }),
  )
}
