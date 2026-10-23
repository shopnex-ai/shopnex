import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import { API_SCOPES, type ApiScope, type ApiToken, type Shop } from '@shopnex/db/schema'

export const API_TOKEN_PREFIX = 'sk_'

// Tokens are 256 bits of CSPRNG output, not user-chosen passwords, so there is nothing to brute-force:
// a fast hash is correct (and keeps per-request lookup cheap). A slow KDF (bcrypt/argon2) would only add latency.
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

// write_* includes read_*
export function hasScope(scopes: readonly ApiScope[], needed: ApiScope) {
  return (
    scopes.includes(needed) ||
    (needed.startsWith('read_') && scopes.includes(needed.replace('read_', 'write_') as ApiScope))
  )
}

// A write scope already grants read: keep the list minimal (and in API_SCOPES order, without duplicates)
export function normalizeScopes(scopes: readonly ApiScope[]): ApiScope[] {
  return API_SCOPES.filter(
    (s) => scopes.includes(s) && !(s.startsWith('read_') && scopes.includes(s.replace('read_', 'write_') as ApiScope)),
  )
}

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
    .insert(schema.apiTokens)
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
    .from(schema.apiTokens)
    .where(and(eq(schema.apiTokens.shopId, shopId), isNull(schema.apiTokens.appId)))
    .orderBy(desc(schema.apiTokens.createdAt))
  return rows.map(publicFields)
}

// Its webhook subscriptions are deleted with it. Null when there's no such live token.
async function revoke(conn: Conn, where: SQL | undefined) {
  return conn.transaction(async (tx) => {
    const [token] = await tx
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(where, isNull(schema.apiTokens.revokedAt)))
      .returning()
    if (!token) return null
    await tx.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.apiTokenId, token.id))
    return publicFields(token)
  })
}

// Hand-made tokens only: an app's token goes away by uninstalling the app
export async function revokeApiToken(shopId: string, id: string) {
  return revoke(
    db,
    and(eq(schema.apiTokens.shopId, shopId), eq(schema.apiTokens.id, id), isNull(schema.apiTokens.appId)),
  )
}

// Any token of the shop (app uninstall)
export async function revokeTokenById(shopId: string, id: string, conn: Conn = db) {
  return revoke(conn, and(eq(schema.apiTokens.shopId, shopId), eq(schema.apiTokens.id, id)))
}

// At most one write a minute per token; not awaited, the request doesn't depend on it
export function touchToken(id: string) {
  db.update(schema.apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(schema.apiTokens.id, id),
        or(isNull(schema.apiTokens.lastUsedAt), lt(schema.apiTokens.lastUsedAt, sql`now() - interval '1 minute'`)),
      ),
    )
    .catch((error) => console.error('[api-tokens] lastUsedAt:', error))
}

// Bearer token → its shop. Null for unknown or revoked tokens.
export async function resolveApiToken(token: string): Promise<{ token: ApiToken; shop: Shop } | null> {
  if (!token.startsWith(API_TOKEN_PREFIX)) return null
  const [row] = await db
    .select({ token: schema.apiTokens, shop: schema.shops })
    .from(schema.apiTokens)
    .innerJoin(schema.shops, eq(schema.shops.id, schema.apiTokens.shopId))
    .where(and(eq(schema.apiTokens.tokenHash, hash(token)), isNull(schema.apiTokens.revokedAt)))
  if (!row) return null
  touchToken(row.token.id)
  return row
}
