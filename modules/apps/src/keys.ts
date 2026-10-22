// This instance's signing key (Ed25519), created on first use. It signs session tokens, access tokens and
// payments requests; apps check them against /api/v1/oauth/jwks. The newest key signs, every stored key is
// published, so rotating = inserting a new row and deleting the old one once its tokens have expired.
import { desc } from 'drizzle-orm'
import { db, schema } from '@shopnex/db'
import {
  generateKeyPair,
  importPublicKey,
  keyId,
  sign,
  signer,
  toJwk,
  type Signer,
} from '@shopnex/marketplace-sdk/keys'
import { instanceUrl } from './marketplace'

let current: Promise<Signer> | null = null

async function loadSigner() {
  const [newest] = await db.select().from(schema.instanceKeys).orderBy(desc(schema.instanceKeys.createdAt)).limit(1)
  if (newest) return signer(newest.privateKey)
  const { privateKey, publicKey } = await generateKeyPair()
  // Two processes starting at once may both create one: both are published, either can sign
  await db
    .insert(schema.instanceKeys)
    .values({ kid: await keyId(publicKey), privateKey, publicKey })
    .onConflictDoNothing()
  return signer(privateKey)
}

export function instanceSigner() {
  current ??= loadSigner().catch((error) => {
    current = null
    throw error
  })
  return current
}

export async function jwks() {
  await instanceSigner()
  const rows = await db.select({ publicKey: schema.instanceKeys.publicKey }).from(schema.instanceKeys)
  return { keys: await Promise.all(rows.map((r) => toJwk(r.publicKey))) }
}

const verifyKeys = new Map<string, CryptoKey>()

/** One of this instance's own public keys by id (verifying tokens it issued) */
export async function ownKey(kid: string | undefined) {
  if (!kid) return null
  const cached = verifyKeys.get(kid)
  if (cached) return cached
  const { keys } = await jwks()
  const jwk = keys.find((k) => k.kid === kid)
  if (!jwk) return null
  const key = await importPublicKey(jwk.x)
  verifyKeys.set(kid, key)
  return key
}

/** A v1a signature of `message` with this instance's key (webhook deliveries) */
export async function instanceSignature(message: string) {
  const { key, kid } = await instanceSigner()
  return { signature: await sign(key, message), kid, instance: await instanceUrl() }
}
