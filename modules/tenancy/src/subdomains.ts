// Shop subdomains (multi mode): with ROOT_DOMAIN=shopnex.app, the shop with slug "acme" is served at
// acme.shopnex.app with no DNS step. Pure functions, no env or database, so they are easy to test.

export type RootDomain = {
  host: string
  port: string
  protocol: 'http' | 'https'
}

// Slugs that must never become a shop's subdomain: they're the platform's own hosts or look like them
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'apps',
  'assets',
  'billing',
  'blog',
  'cdn',
  'checkout',
  'dashboard',
  'default',
  'docs',
  'email',
  'ftp',
  'help',
  'login',
  'mail',
  'marketplace',
  'signup',
  'smtp',
  'static',
  'status',
  'stripe',
  'support',
  'www',
])

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

// Can this slug be a hostname label (and isn't the platform's)?
export const isSubdomainSlug = (slug: string) => LABEL.test(slug) && !RESERVED_SLUGS.has(slug)

/**
 * Reads ROOT_DOMAIN: "shopnex.app", "https://shopnex.app" or "localhost:4321". The protocol is the one written
 * there, else the app's own (`appUrl`), else https. Null when unset or not a hostname.
 */
export function parseRootDomain(raw: string | undefined, appUrl?: string): RootDomain | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return null
  const scheme = /^(https?):\/\//.exec(value)?.[1] as RootDomain['protocol'] | undefined
  const [host = '', port = ''] = value
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .split(':')
  if (!host.split('.').every((label) => LABEL.test(label))) return null
  if (port && !/^\d{1,5}$/.test(port)) return null
  let protocol: RootDomain['protocol'] = 'https'
  if (scheme) protocol = scheme
  else if (appUrl?.startsWith('http://')) protocol = 'http'
  return { host, port, protocol }
}

// "acme.shopnex.app" → "acme". Null for the root itself, deeper hosts ("a.b.shopnex.app"), reserved
// labels and hosts outside the root.
export function subdomainSlug(host: string, root: RootDomain) {
  const suffix = `.${root.host}`
  const name = host.toLowerCase()
  if (!name.endsWith(suffix)) return null
  const label = name.slice(0, -suffix.length)
  return isSubdomainSlug(label) ? label : null
}

// Is `host` the root domain or anything under it? Custom domains can't claim these.
export const isUnderRoot = (host: string, root: RootDomain) => host === root.host || host.endsWith(`.${root.host}`)

export const subdomainUrl = (slug: string, root: RootDomain) =>
  `${root.protocol}://${slug}.${root.host}${root.port ? `:${root.port}` : ''}`
