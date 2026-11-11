export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true
  }
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part > 255)) return true
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export type ClassifiedUrl =
  | { kind: "fixture" }
  | { kind: "public"; url: string }
  | { kind: "blocked"; reason: string }
  | { kind: "empty" }

export function classifyPageUrl(raw: string, requestHost?: string): ClassifiedUrl {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: "empty" }
  if (trimmed === "fixture:broken" || trimmed === "/fixture/broken.html") return { kind: "fixture" }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { kind: "blocked", reason: "That is not a valid http or https URL." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "blocked", reason: "Only http and https pages can be checked." }
  }
  if (url.username || url.password) {
    return { kind: "blocked", reason: "Remove the username and password from the URL and try again." }
  }
  if (url.pathname === "/fixture/broken.html") {
    const requestName = (requestHost || "").split(":")[0].toLowerCase()
    if (isBlockedHost(url.hostname) || (requestName && url.hostname.toLowerCase() === requestName)) {
      return { kind: "fixture" }
    }
  }
  if (isBlockedHost(url.hostname)) {
    return {
      kind: "blocked",
      reason: "Otari refuses private and loopback addresses. Use the broken demo, paste the HTML, or give a public URL.",
    }
  }
  return { kind: "public", url: url.toString() }
}

export function extractExplicitUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []
  const urls: string[] = []
  for (const raw of found) {
    const cleaned = raw.replace(/[.,;:]+$/, "")
    try {
      const url = new URL(cleaned)
      if ((url.protocol === "http:" || url.protocol === "https:") && !isBlockedHost(url.hostname) && !url.username) {
        urls.push(url.toString())
      }
    } catch {
      continue
    }
  }
  return [...new Set(urls)]
}

export function extractDomains(text: string): string[] {
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"')\]]+/gi, " ")
  const matches = withoutUrls.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) ?? []
  const domains: string[] = []
  for (const match of matches) {
    const host = match.toLowerCase().replace(/\.$/, "")
    if (isBlockedHost(host) || host.endsWith(".html") || host.endsWith(".js") || host.endsWith(".css")) continue
    domains.push(host)
  }
  return [...new Set(domains)]
}

export function searchPlan(howto: string): { query: string; domains: string[] } | null {
  const domains = extractDomains(howto)
  if (domains.length > 0) return { query: domains[0] ?? "", domains: domains.slice(0, 20) }
  const named = howto.match(/\b(?:on|in|at|using|via)\s+([A-Z][A-Za-z0-9-]{2,})\b/)
  if (named?.[1]) return { query: named[1], domains: [] }
  return null
}

export function hostMatches(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

export function publicHttpsUrl(raw: string | null): URL | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || isBlockedHost(url.hostname)) return null
    return url
  } catch {
    return null
  }
}
