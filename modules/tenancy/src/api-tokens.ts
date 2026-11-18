import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { db, type Conn } from '@shopnex/db'
import { normalizeScopes } from '@shopnex/core/scopes'
import { webhookService } from '@shopnex/webhooks'
import { log } from './log'
import { type ApiScope, type ApiToken, apiTokens, type Shop, shops } from '@shopnex/core/schema'

export const API_TOKEN_PREFIX = 'sk_'

// Tokens are 256 bits of CSPRNG output, not user-chosen passwords, so there is nothing to brute-force:
// a fast hash is correct (and keeps per-request lookup cheap). A slow KDF (bcrypt/argon2) would only add latency.
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

// A new secret: the plaintext goes to the caller once, only the hash and prefix are stored
export function mintToken() {
  const token = API_TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, tokenHash: hash(token), tokenPrefix: token.slice(0, API_TOKEN_PREFIX.length + 6) }
}

// Hand-made token (Settings → API tokens). The plaintext token is only in this return value.
export async function createApiToken(
  shopId: string,
  input: { name: string; scopes: ApiScope[]; createdById: string | null },
) {
  const { token, ...secret } = mintToken()
  const [row] = await db
    .insert(apiTokens)
    .values({
      shopId,
      name: input.name,
      scopes: normalizeScopes(input.scopes),
      createdById: input.createdById,
      ...secret,
    })
    .returning()
  return { ...publicFields(row!), token }
}

// Everything but the hash
export function publicFields({ tokenHash: _, ...token }: ApiToken) {
  return token
}

export async function listApiTokens(shopId: string) {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.shopId, shopId), isNull(apiTokens.appId)))
    .orderBy(desc(apiTokens.createdAt))
  return rows.map(publicFields)
}

// Its webhook subscriptions go with it. Null when there's no such live token.
async function revoke(conn: Conn, where: SQL | undefined) {
  return conn.transaction(async (tx) => {
    const [token] = await tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(where, isNull(apiTokens.revokedAt)))
      .returning()
    if (!token) return null
    await webhookService.removeOfToken(token.id, tx)
    return publicFields(token)
  })
}

// Hand-made tokens only: an app's token goes away by uninstalling the app
export async function revokeApiToken(shopId: string, id: string) {
  return revoke(db, and(eq(apiTokens.shopId, shopId), eq(apiTokens.id, id), isNull(apiTokens.appId)))
}

// Any token of the shop (app uninstall)
export async function revokeTokenById(shopId: string, id: string, conn: Conn = db) {
  return revoke(conn, and(eq(apiTokens.shopId, shopId), eq(apiTokens.id, id)))
}

// At most one write a minute per token; not awaited, the request doesn't depend on it
export function touchToken(id: string) {
  db.update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiTokens.id, id),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`)),
      ),
    )
    .catch((error) => log.error({ err: error }, 'could not update the API token lastUsedAt'))
}

// Bearer token → its shop. Null for unknown or revoked tokens.
export async function resolveApiToken(token: string): Promise<{ token: ApiToken; shop: Shop } | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null
  const [row] = await db
    .select({ token: apiTokens, shop: shops })
    .from(apiTokens)
    .innerJoin(shops, eq(shops.id, apiTokens.shopId))
    .where(and(eq(apiTokens.tokenHash, hash(token)), isNull(apiTokens.revokedAt)))
  if (!row) return null
  touchToken(row.token.id)
  return row
}
