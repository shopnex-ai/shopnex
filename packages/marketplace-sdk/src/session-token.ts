// Session tokens for embedded apps: a JWT (EdDSA) the Shopnex admin hands the app's frontend (see
// @shopnex/app-bridge), saying which staff member of which shop is using the app right now. The instance signs
// it with its own key; the app's backend checks it against the instance's published keys (createJwksResolver),
// so the app needs nothing stored per install. Trade it for an Admin API token with the token exchange grant.
// WebCrypto only, so it runs in Node 20+, edge runtimes and browsers.
import { decodeJwt, signJwt, verifyJwt, type KeyResolver, type Signer } from './keys'

export type SessionTokenClaims = {
  /** The Shopnex instance's public origin */
  iss: string
  /** The app's client_id */
  aud: string
  /** Staff user id */
  sub: string
  shop_id: string
  /** Installation id */
  sid: string
  iat: number
  nbf: number
  exp: number
  jti: string
}

export const SESSION_TOKEN_TYP = 'shopnex-session+jwt'

/** Instance side: signs claims valid for `ttlSeconds` (default 60) */
export async function signSessionToken(
  signer: Signer,
  claims: Omit<SessionTokenClaims, 'iat' | 'nbf' | 'exp' | 'jti'>,
  ttlSeconds = 60,
) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt(signer, SESSION_TOKEN_TYP, {
    ...claims,
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  } satisfies SessionTokenClaims)
}

/** Reads claims without verifying them */
export function decodeSessionToken(token: string): SessionTokenClaims | null {
  return decodeJwt<SessionTokenClaims>(token)?.claims ?? null
}

/**
 * Verifies the signature (with the key of the instance named in `iss`), expiry and audience.
 * Returns the claims, or null if the token isn't valid.
 */
export async function verifySessionToken(
  token: string,
  options: { clientId: string; keys: KeyResolver; leewaySeconds?: number },
): Promise<SessionTokenClaims | null> {
  const claims = await verifyJwt<SessionTokenClaims>(
    token,
    SESSION_TOKEN_TYP,
    (header, claims) => (typeof claims.iss === 'string' ? options.keys(claims.iss, header.kid) : Promise.resolve(null)),
    options.leewaySeconds,
  )
  return claims && claims.aud === options.clientId && typeof claims.shop_id === 'string' ? claims : null
}
