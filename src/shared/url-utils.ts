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

/**
 * Parse a canonical dotted-decimal IPv4 literal into its four octets, or
 * `null` if `host` is not such a literal. Intended for `URL.hostname`, which
 * the WHATWG parser already normalizes (`0x7f.0.0.1`, `2130706433`, `0177...`
 * all collapse to dotted-decimal), so octal/hex/decimal evasions are handled
 * before we get here. Any non-IPv4 host (hostnames, IPv6) returns `null`.
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    octets.push(n)
  }
  return octets as [number, number, number, number]
}

/**
 * True iff `hostname` is an IPv4 literal in a private (RFC 1918) or link-local
 * range — i.e. reachable only on the user's own LAN, never on the public
 * internet. Used to allow plain `http://` to local servers (Ollama, LM Studio
 * on another box) while still blocking `http://` to public hosts, where it
 * would leak the api key in cleartext. Only IPv4 literals qualify; hostnames
 * are rejected (we don't resolve DNS — that would invite rebinding), so the
 * failure mode is fail-closed.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const ip = parseIPv4(hostname)
  if (!ip) return false
  const [a, b] = ip
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local)
  return false
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
