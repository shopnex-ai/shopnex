// Preview tokens let the theme editor's iframe show the draft: the storefront page gets the token in its
// URL and passes it to `storefront.theme.get`, which returns that library copy's draft instead of what the
// live theme published (so unpublished copies can be previewed too).
// Format: base64url(JSON payload) "." base64url(HMAC-SHA256). Signed with BETTER_AUTH_SECRET under its own
// label, so a preview token is never valid as anything else.
import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL_SECONDS = 60 * 60
const LABEL = 'shopnex:theme-preview:v1'

// `copy`: the shop_themes row
type Payload = { shop: string; copy: string; exp: number }

function key() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  return createHmac('sha256', secret).update(LABEL).digest()
}

const sign = (body: string) => createHmac('sha256', key()).update(body).digest('base64url')

export function createPreviewToken(shopId: string, copyId: string, now = Date.now()) {
  const expiresAt = new Date(now + TTL_SECONDS * 1000)
  const payload: Payload = { shop: shopId, copy: copyId, exp: Math.floor(expiresAt.getTime() / 1000) }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${body}.${sign(body)}`, expiresAt }
}

/** The copy id when the token was issued for this shop and hasn't expired, else null */
export function verifyPreviewToken(token: string, shopId: string, now = Date.now()) {
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const payload: Payload = JSON.parse(Buffer.from(body, 'base64url').toString())
    return payload.shop === shopId && typeof payload.copy === 'string' && payload.exp * 1000 > now ? payload.copy : null
  } catch {
    return null
  }
}
