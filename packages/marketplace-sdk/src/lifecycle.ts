// App lifecycle events: Shopnex tells an app about changes to its installation, so it can set a shop up without
// waiting for someone to open it (a payments app registers its payment method, for one).
//
//   POST {appUrl}/shopnex/installed   a signed AppInstalledRequest, right after the app is installed on a shop
//
// Delivery is best effort, once, and may repeat (reinstalls, retries): handle it idempotently. An app that
// misses it should still set itself up when it's first opened. Requests are signed exactly like payments
// requests (Standard Webhooks, the instance's Ed25519 key). WebCrypto only.
import { sign, verify, type KeyResolver, type Signer } from './keys'

export const APP_INSTALLED_PATH = '/shopnex/installed'

export type AppInstalledRequest = {
  kind: 'installed'
  /** Unique per delivery */
  id: string
  /** The Shopnex instance's public origin: its keys sign this request, its Admin API is where the app acts */
  instance: string
  shopId: string
  installationId: string
}

const KEY_ID_HEADER = 'shopnex-key-id'

/** Instance side: headers for one request with this exact body */
export async function signLifecycleRequest(signer: Signer, id: string, body: string, now = new Date()) {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    'content-type': 'application/json',
    'user-agent': 'Shopnex-Lifecycle/1.0',
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': 'v1a,' + (await sign(signer.key, `${id}.${timestamp}.${body}`)),
    [KEY_ID_HEADER]: signer.kid,
  }
}

/**
 * App side: checks the signature (with the keys of the instance the body names) and that it's under 5 minutes
 * old, and returns the parsed request, or null. Pass the raw body text, not re-serialized JSON.
 */
export async function verifyLifecycleRequest(
  headers: Headers,
  body: string,
  { keys, toleranceSeconds = 300 }: { keys: KeyResolver; toleranceSeconds?: number },
): Promise<AppInstalledRequest | null> {
  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatures = headers.get('webhook-signature')
  if (!id || !timestamp || !signatures) return null
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return null
  let request: AppInstalledRequest
  try {
    request = JSON.parse(body) as AppInstalledRequest
  } catch {
    return null
  }
  if (request?.kind !== 'installed' || typeof request.instance !== 'string') return null
  const key = await keys(request.instance, headers.get(KEY_ID_HEADER) ?? undefined)
  if (!key) return null
  const message = `${id}.${timestamp}.${body}`
  for (const s of signatures.split(' ')) {
    if (s.startsWith('v1a,') && (await verify(key, message, s.slice(4)))) return request
  }
  return null
}
