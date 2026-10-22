// Ed25519 keys and EdDSA JWTs. No shared secrets anywhere:
//   - each Shopnex instance signs session tokens, access tokens and payments requests with its own key and
//     publishes the public half at GET {instance}/api/v1/oauth/jwks;
//   - each app holds a private key (SHOPNEX_APP_KEY, snxk_…) and proves who it is with a short-lived client
//     assertion (RFC 7523) addressed to one server. Instances and the marketplace only store its public key.
// A party that receives a token can't reuse it anywhere else: tokens name their audience and expire in seconds.
// WebCrypto only, so it runs in Node 20+, edge runtimes and browsers.

export const PRIVATE_KEY_PREFIX = 'snxk_'
export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
/** Where an instance publishes its public keys (relative to its origin) */
export const JWKS_PATH = '/api/v1/oauth/jwks'

export type PublicJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; alg: 'EdDSA'; use: 'sig' }
export type Jwks = { keys: PublicJwk[] }
/** A private key and the id it's published under */
export type Signer = { key: CryptoKey; kid: string }
/** Finds the public key for a token: `iss` is the issuer's origin, `kid` the header's key id */
export type KeyResolver = (iss: string, kid: string | undefined) => Promise<CryptoKey | null>

const ED25519 = { name: 'Ed25519' } as const
const encoder = new TextEncoder()

export const base64url = (bytes: Uint8Array) => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const fromBase64url = (s: string) => {
  const binary = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
const json = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)))

// --- keys ---

/**
 * A new key pair. `privateKey` (snxk_…) stays with its owner; `publicKey` (the raw key, base64url) is what
 * others store to check signatures.
 */
export async function generateKeyPair() {
  const pair = (await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as CryptoKeyPair
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { privateKey: PRIVATE_KEY_PREFIX + base64url(pkcs8), publicKey: base64url(raw) }
}

export function importPrivateKey(privateKey: string) {
  if (!privateKey.startsWith(PRIVATE_KEY_PREFIX)) throw new Error(`Not a Shopnex private key (${PRIVATE_KEY_PREFIX}…)`)
  const pkcs8 = fromBase64url(privateKey.slice(PRIVATE_KEY_PREFIX.length))
  // Extractable so publicKeyOf can read the public half from the JWK
  return crypto.subtle.importKey('pkcs8', pkcs8, ED25519, true, ['sign'])
}

export async function importPublicKey(publicKey: string) {
  return crypto.subtle.importKey('raw', fromBase64url(publicKey), ED25519, true, ['verify'])
}

/** The public key (base64url) that goes with a private key */
export async function publicKeyOf(privateKey: string | CryptoKey) {
  const key = typeof privateKey === 'string' ? await importPrivateKey(privateKey) : privateKey
  const jwk = await crypto.subtle.exportKey('jwk', key)
  if (!jwk.x) throw new Error('Not an Ed25519 key')
  return jwk.x
}

/** Stable id of a public key: published as `kid` and put in token headers */
export async function keyId(publicKey: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(publicKey)))
  return base64url(digest).slice(0, 16)
}

export async function signer(privateKey: string): Promise<Signer> {
  const key = await importPrivateKey(privateKey)
  return { key, kid: await keyId(await publicKeyOf(key)) }
}

export async function toJwk(publicKey: string): Promise<PublicJwk> {
  return { kty: 'OKP', crv: 'Ed25519', x: publicKey, kid: await keyId(publicKey), alg: 'EdDSA', use: 'sig' }
}

// --- signatures and JWTs ---

export async function sign(key: CryptoKey, message: string) {
  return base64url(new Uint8Array(await crypto.subtle.sign(ED25519, key, encoder.encode(message))))
}

export async function verify(key: CryptoKey, message: string, signature: string) {
  try {
    return await crypto.subtle.verify(ED25519, key, fromBase64url(signature), encoder.encode(message))
  } catch {
    return false
  }
}

export type JwtHeader = { alg: 'EdDSA'; typ: string; kid?: string }

export async function signJwt(signer: { key: CryptoKey; kid?: string }, typ: string, claims: object) {
  const header: JwtHeader = { alg: 'EdDSA', typ, ...(signer.kid && { kid: signer.kid }) }
  const unsigned = `${json(header)}.${json(claims)}`
  return `${unsigned}.${await sign(signer.key, unsigned)}`
}

/** Header and claims without checking anything: only to find which key verifies the token */
export function decodeJwt<T = Record<string, unknown>>(token: string): { header: JwtHeader; claims: T } | null {
  try {
    const [header, payload] = token.split('.')
    if (!header || !payload) return null
    const decode = (part: string) => JSON.parse(new TextDecoder().decode(fromBase64url(part)))
    return { header: decode(header) as JwtHeader, claims: decode(payload) as T }
  } catch {
    return null
  }
}

type TimeClaims = { iat?: number; nbf?: number; exp?: number }

/**
 * Checks the signature (EdDSA only), `typ` and the time claims (`leewaySeconds` of clock skew).
 * Returns the claims, or null if the token isn't valid.
 */
export async function verifyJwt<T extends TimeClaims>(
  token: string,
  typ: string,
  key: CryptoKey | ((header: JwtHeader, claims: T) => Promise<CryptoKey | null>),
  leewaySeconds = 5,
): Promise<T | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const decoded = decodeJwt<T>(token)
  if (!decoded || decoded.header.alg !== 'EdDSA' || decoded.header.typ !== typ) return null
  const publicKey = typeof key === 'function' ? await key(decoded.header, decoded.claims) : key
  if (!publicKey || !(await verify(publicKey, `${parts[0]}.${parts[1]}`, parts[2]!))) return null
  const now = Math.floor(Date.now() / 1000)
  const { exp, nbf } = decoded.claims
  if (typeof exp !== 'number' || exp + leewaySeconds < now) return null
  if (typeof nbf === 'number' && nbf - leewaySeconds > now) return null
  return decoded.claims
}

// --- client assertions (app → instance / marketplace) ---

export type ClientAssertionClaims = { iss: string; sub: string; aud: string; iat: number; exp: number; jti: string }
const ASSERTION_TYP = 'JWT'

/** App side: proves to `audience` (the origin being called) that this is `clientId`. Valid 60 seconds. */
export async function createClientAssertion(privateKey: string | CryptoKey, clientId: string, audience: string) {
  const key = typeof privateKey === 'string' ? await importPrivateKey(privateKey) : privateKey
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ key }, ASSERTION_TYP, {
    iss: clientId,
    sub: clientId,
    aud: new URL(audience).origin,
    iat: now,
    exp: now + 60,
    jti: crypto.randomUUID(),
  } satisfies ClientAssertionClaims)
}

/** Server side: true when the assertion is signed by `publicKey`, for `clientId`, addressed to `audience` */
export async function verifyClientAssertion(
  assertion: string,
  publicKey: string,
  options: { clientId: string; audience: string },
) {
  const claims = await verifyJwt<ClientAssertionClaims>(assertion, ASSERTION_TYP, await importPublicKey(publicKey))
  if (!claims) return false
  const now = Math.floor(Date.now() / 1000)
  return (
    claims.iss === options.clientId &&
    claims.sub === options.clientId &&
    claims.aud === new URL(options.audience).origin &&
    // Short-lived only: a leaked assertion is useless a minute later
    claims.exp - (claims.iat ?? now) <= 300
  )
}

// --- finding an instance's keys (app side) ---

export type JwksResolverOptions = {
  /**
   * Origins allowed over plain http. Default: localhost and 127.0.0.1 only; everything else must be https.
   * Pass `true` to allow any (development only).
   */
  allowHttp?: boolean | ((origin: string) => boolean)
  /** Only these instances are trusted at all (e.g. checked against the marketplace) */
  allowIssuer?: (origin: string) => boolean | Promise<boolean>
  /** How long fetched keys are kept (default 1 hour). An unknown `kid` refetches at most once a minute. */
  ttlMs?: number
  fetch?: typeof fetch
}

const isLocal = (origin: string) => /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)

/** Resolves (and caches) public keys from each instance's JWKS endpoint */
export function createJwksResolver(options: JwksResolverOptions = {}): KeyResolver {
  const cache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>()
  const ttl = options.ttlMs ?? 3600_000
  const doFetch = options.fetch ?? fetch

  const allowed = (origin: string) => {
    if (origin.startsWith('https://')) return true
    if (!origin.startsWith('http://')) return false
    const allowHttp = options.allowHttp
    return typeof allowHttp === 'function' ? allowHttp(origin) : (allowHttp ?? isLocal(origin))
  }

  async function load(origin: string) {
    const res = await doFetch(origin + JWKS_PATH, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`JWKS ${origin}: ${res.status}`)
    const body = (await res.json()) as Jwks
    const keys = new Map<string, CryptoKey>()
    for (const jwk of body.keys ?? []) {
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.kid || !jwk.x) continue
      keys.set(jwk.kid, await importPublicKey(jwk.x))
    }
    const entry = { keys, fetchedAt: Date.now() }
    cache.set(origin, entry)
    return entry
  }

  return async (iss, kid) => {
    let origin: string
    try {
      origin = new URL(iss).origin
    } catch {
      return null
    }
    if (origin !== iss || !allowed(origin)) return null
    if (options.allowIssuer && !(await options.allowIssuer(origin))) return null
    let entry = cache.get(origin)
    const age = entry ? Date.now() - entry.fetchedAt : Infinity
    // Expired, or a key we haven't seen (the instance rotated): fetch again, but not more than once a minute
    if (age > ttl || (kid && !entry!.keys.has(kid) && age > 60_000)) {
      entry = await load(origin).catch((error) => {
        console.warn(`[shopnex] ${error instanceof Error ? error.message : error}`)
        return entry
      })
    }
    if (!entry || !kid) return null
    return entry.keys.get(kid) ?? null
  }
}
