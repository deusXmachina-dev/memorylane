/**
 * Coarse same-domain check used to constrain URLs to a known registrable
 * domain (eTLD+1 approximation). We deliberately do NOT pull in a public
 * suffix list dependency — for the cases we care about (our backend on
 * `*.trymemorylane.com`, vendor APIs on `*.openrouter.ai` /
 * `*.googleapis.com`, and `localhost` in dev) the last-two-labels rule is
 * sufficient.
 *
 * Returns the registrable domain in lowercase, or the hostname unchanged for
 * IP literals and single-label hosts (e.g. `localhost`).
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase()
  // IPv6 literal in URL form keeps brackets in `URL.hostname`; bare IPv6
  // (without brackets) contains colons. Either way: compare exact.
  if (host.startsWith('[') || host.includes(':')) return host
  // IPv4 literal — all-numeric labels separated by dots.
  if (/^[\d.]+$/.test(host)) return host
  if (!host.includes('.')) return host
  const labels = host.split('.')
  return labels.slice(-2).join('.')
}

function hostnameOf(input: string): string | null {
  try {
    return new URL(input).hostname
  } catch {
    return null
  }
}

/**
 * Returns true iff both URLs parse and share a registrable domain (or are
 * both the same single-label / IP host). Returns false on any parse error
 * — callers should treat that as a rejection.
 */
export function isSameRegistrableDomain(a: string, b: string): boolean {
  const aHost = hostnameOf(a)
  const bHost = hostnameOf(b)
  if (aHost === null || bHost === null) return false
  return registrableDomain(aHost) === registrableDomain(bHost)
}
